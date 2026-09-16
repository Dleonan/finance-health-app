import { Injectable, Logger } from '@nestjs/common';
import { DataProvider, SyncRunStatus, WebhookEventStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PluggyAdapter } from '../integrations/pluggy/pluggy.adapter';
import { ProviderDataError } from '../integrations/pluggy/pluggy.adapter';
import { PluggyClientService } from '../integrations/pluggy/pluggy.client';
import { FinancialSummaryService } from '../finance-health/financial-summary.service';
import { normalizeMerchant } from './merchant-normalizer';
import { MetricsService } from '../observability/metrics.service';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pluggy: PluggyClientService,
    private readonly adapter: PluggyAdapter,
    private readonly summary: FinancialSummaryService,
    private readonly metrics: MetricsService,
  ) {}

  async process(runId: string) {
    const startedAt = Date.now();
    const run = await this.prisma.syncRun.findUnique({
      where: { id: runId },
      include: { connection: true },
    });
    if (!run || run.status !== SyncRunStatus.RUNNING) return;
    this.metrics.increment('sync_started_total');
    if (run.triggerEventId) {
      await this.prisma.webhookEvent.updateMany({
        where: { provider: DataProvider.PLUGGY, eventId: run.triggerEventId },
        data: { status: WebhookEventStatus.PROCESSING, attempts: { increment: 1 } },
      });
    }

    try {
      const counters = await this.syncConnection(
        run.connectionId,
        run.triggerEventType,
        run.resourceId,
      );
      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: { ...counters, status: SyncRunStatus.SUCCEEDED, finishedAt: new Date() },
      });
      await this.prisma.connection.update({
        where: { id: run.connectionId },
        data: {
          status: 'CONNECTED',
          lastSyncedAt: new Date(),
          lastErrorAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      if (run.triggerEventId) {
        await this.prisma.webhookEvent.updateMany({
          where: { provider: DataProvider.PLUGGY, eventId: run.triggerEventId },
          data: {
            status: WebhookEventStatus.PROCESSED,
            processedAt: new Date(),
            attempts: { increment: 1 },
          },
        });
      }
      await this.summary.persistSnapshot(run.connection.userId);
      this.metrics.increment('sync_completed_total');
      this.metrics.observe('sync_duration_ms', Date.now() - startedAt);
    } catch (error) {
      const errorCode =
        error instanceof ProviderDataError ? 'PROVIDER_DATA_INVALID' : 'SYNC_FAILED';
      this.logger.error(
        `sync failed run=${run.id} connection=${run.connectionId} code=${errorCode}`,
      );
      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: SyncRunStatus.FAILED,
          finishedAt: new Date(),
          errorCode,
          errorMessage: error instanceof Error ? error.message.slice(0, 300) : 'Unknown sync error',
        },
      });
      await this.prisma.connection.update({
        where: { id: run.connectionId },
        data: {
          status: 'ERROR',
          lastErrorAt: new Date(),
          lastErrorCode: errorCode,
          lastErrorMessage: 'Sincronização indisponível',
        },
      });
      if (run.triggerEventId) {
        await this.prisma.webhookEvent.updateMany({
          where: { provider: DataProvider.PLUGGY, eventId: run.triggerEventId },
          data: {
            status: WebhookEventStatus.FAILED,
            processedAt: new Date(),
            attempts: { increment: 1 },
            lastError: errorCode,
          },
        });
      }
      this.metrics.increment('sync_failed_total');
      this.metrics.observe('sync_duration_ms', Date.now() - startedAt);
    }
  }

  private async syncConnection(
    connectionId: string,
    triggerEventType?: string | null,
    resourceId?: string | null,
  ) {
    const connection = await this.prisma.connection.findUniqueOrThrow({
      where: { id: connectionId },
    });
    const syncAt = new Date();
    const item = await this.pluggy.fetchItem(connection.providerItemId);
    const itemRecord = item as unknown as Record<string, unknown>;
    const institution = this.readInstitution(itemRecord);
    if (institution)
      await this.prisma.connection.update({ where: { id: connectionId }, data: { institution } });

    const dateFrom = new Date(
      connection.lastSyncedAt
        ? connection.lastSyncedAt.getTime() - 3 * DAY_MS
        : Date.now() - 90 * DAY_MS,
    ).toISOString();
    const providerAccounts = await this.pluggy.fetchAccounts(connection.providerItemId);
    const categoryRules = await this.prisma.categoryRule.findMany({
      where: { userId: connection.userId, enabled: true },
      orderBy: { priority: 'desc' },
      select: { categoryId: true, field: true, operator: true, value: true },
    });
    let accountsProcessed = 0;
    let transactionsProcessed = 0;
    let billsProcessed = 0;

    for (const rawAccount of providerAccounts) {
      const mappedAccount = this.adapter.mapAccount(rawAccount);
      const account = await this.prisma.account.upsert({
        where: {
          connectionId_provider_providerAccountId: {
            connectionId,
            provider: DataProvider.PLUGGY,
            providerAccountId: mappedAccount.providerAccountId,
          },
        },
        create: {
          connectionId,
          provider: DataProvider.PLUGGY,
          providerAccountId: mappedAccount.providerAccountId,
          name: mappedAccount.name,
          kind: mappedAccount.kind,
          currency: mappedAccount.currency,
          currentBalance: mappedAccount.currentBalance,
          availableBalance: mappedAccount.availableBalance,
          creditLimit: mappedAccount.creditLimit,
          lastProviderSyncAt: syncAt,
        },
        update: {
          name: mappedAccount.name,
          kind: mappedAccount.kind,
          currency: mappedAccount.currency,
          currentBalance: mappedAccount.currentBalance,
          availableBalance: mappedAccount.availableBalance,
          creditLimit: mappedAccount.creditLimit,
          lastProviderSyncAt: syncAt,
        },
      });
      accountsProcessed += 1;

      await this.prisma.accountBalanceSnapshot.upsert({
        where: { accountId_snapshotAt: { accountId: account.id, snapshotAt: syncAt } },
        create: {
          accountId: account.id,
          snapshotAt: syncAt,
          currentBalance: mappedAccount.currentBalance,
          availableBalance: mappedAccount.availableBalance,
          creditLimit: mappedAccount.creditLimit,
        },
        update: {
          currentBalance: mappedAccount.currentBalance,
          availableBalance: mappedAccount.availableBalance,
          creditLimit: mappedAccount.creditLimit,
        },
      });

      const billMap = new Map<string, string>();
      if (mappedAccount.kind === 'CREDIT_CARD') {
        const providerBills = await this.optional(() =>
          this.pluggy.fetchBills(mappedAccount.providerAccountId),
        );
        for (const rawBill of providerBills) {
          const bill = this.adapter.mapBill(rawBill);
          const persisted = await this.prisma.creditCardBill.upsert({
            where: {
              accountId_provider_providerBillId: {
                accountId: account.id,
                provider: DataProvider.PLUGGY,
                providerBillId: bill.providerBillId,
              },
            },
            create: { accountId: account.id, provider: DataProvider.PLUGGY, ...bill },
            update: { ...bill },
          });
          billMap.set(bill.providerBillId, persisted.id);
          billsProcessed += 1;
        }
      }

      const providerTransactions = await this.pluggy.fetchAllTransactions(
        mappedAccount.providerAccountId,
        dateFrom,
      );
      const normalizedTransactions = providerTransactions.map((raw) =>
        this.adapter.mapTransaction(raw),
      );
      const recurringKeys = this.recurringKeys(normalizedTransactions);
      for (const transaction of normalizedTransactions) {
        const merchantNormalized = normalizeMerchant(
          transaction.merchantRaw ?? transaction.description,
        );
        const userCategoryId = this.matchCategory(
          transaction.description,
          transaction.merchantRaw,
          categoryRules,
        );
        await this.prisma.transaction.upsert({
          where: {
            accountId_provider_providerTransactionId: {
              accountId: account.id,
              provider: DataProvider.PLUGGY,
              providerTransactionId: transaction.providerTransactionId,
            },
          },
          create: {
            accountId: account.id,
            provider: DataProvider.PLUGGY,
            providerTransactionId: transaction.providerTransactionId,
            postedAt: transaction.postedAt,
            description: transaction.description,
            merchantRaw: transaction.merchantRaw,
            merchantNormalized,
            amount: transaction.amount,
            direction: transaction.direction,
            providerCategoryId: transaction.providerCategoryId,
            userCategoryId,
            status: transaction.status,
            billId: transaction.providerBillId
              ? billMap.get(transaction.providerBillId)
              : undefined,
            installmentNumber: transaction.installmentNumber,
            installmentTotal: transaction.installmentTotal,
            isTransfer: transaction.isTransfer,
            isRecurringCandidate: recurringKeys.has(`${merchantNormalized}|${transaction.amount}`),
            deletedAt: null,
          },
          update: {
            postedAt: transaction.postedAt,
            description: transaction.description,
            merchantRaw: transaction.merchantRaw,
            merchantNormalized,
            amount: transaction.amount,
            direction: transaction.direction,
            providerCategoryId: transaction.providerCategoryId,
            ...(userCategoryId ? { userCategoryId } : {}),
            status: transaction.status,
            billId: transaction.providerBillId
              ? billMap.get(transaction.providerBillId)
              : undefined,
            installmentNumber: transaction.installmentNumber,
            installmentTotal: transaction.installmentTotal,
            isTransfer: transaction.isTransfer,
            isRecurringCandidate: recurringKeys.has(`${merchantNormalized}|${transaction.amount}`),
            deletedAt: null,
          },
        });
        this.metrics.increment('transactions_upserted_total');
        transactionsProcessed += 1;
      }
    }

    if (triggerEventType?.includes('deleted') && resourceId) {
      await this.prisma.transaction.updateMany({
        where: {
          provider: DataProvider.PLUGGY,
          providerTransactionId: resourceId,
          account: { connectionId },
        },
        data: { deletedAt: syncAt },
      });
    }

    const providerInvestments = await this.optional(() =>
      this.pluggy.fetchInvestments(connection.providerItemId),
    );
    for (const rawInvestment of providerInvestments) {
      const investment = this.adapter.mapInvestment(rawInvestment);
      const persisted = await this.prisma.investment.upsert({
        where: {
          connectionId_provider_providerInvestmentId: {
            connectionId,
            provider: DataProvider.PLUGGY,
            providerInvestmentId: investment.providerInvestmentId,
          },
        },
        create: { connectionId, provider: DataProvider.PLUGGY, ...investment },
        update: { ...investment },
      });
      await this.prisma.investmentSnapshot.upsert({
        where: { investmentId_snapshotAt: { investmentId: persisted.id, snapshotAt: syncAt } },
        create: { investmentId: persisted.id, snapshotAt: syncAt, balance: investment.balance },
        update: { balance: investment.balance },
      });
    }

    const providerLoans = await this.optional(() =>
      this.pluggy.fetchLoans(connection.providerItemId),
    );
    for (const rawLoan of providerLoans) {
      const loan = this.adapter.mapLoan(rawLoan);
      await this.prisma.loan.upsert({
        where: {
          connectionId_provider_providerLoanId: {
            connectionId,
            provider: DataProvider.PLUGGY,
            providerLoanId: loan.providerLoanId,
          },
        },
        create: { connectionId, provider: DataProvider.PLUGGY, ...loan },
        update: { ...loan },
      });
    }

    await this.detectInternalTransfers(connection.userId);

    return {
      accountsProcessed,
      transactionsProcessed,
      billsProcessed,
      investmentsProcessed: providerInvestments.length,
      loansProcessed: providerLoans.length,
    };
  }

  private async optional<T>(operation: () => Promise<T[]>) {
    try {
      return await operation();
    } catch {
      return [];
    }
  }

  private recurringKeys(
    transactions: Array<{ merchantRaw: string | null; description: string; amount: string }>,
  ) {
    const counts = new Map<string, number>();
    for (const transaction of transactions) {
      const key = `${normalizeMerchant(transaction.merchantRaw ?? transaction.description)}|${transaction.amount}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count >= 2).map(([key]) => key));
  }

  private readInstitution(item: Record<string, unknown>) {
    const connector = item.connector;
    if (connector && typeof connector === 'object') {
      const name = (connector as Record<string, unknown>).name;
      return typeof name === 'string' ? name : null;
    }
    return typeof item.institution === 'string' ? item.institution : null;
  }

  private matchCategory(
    description: string,
    merchantRaw: string | null,
    rules: Array<{ categoryId: string; field: string; operator: string; value: string }>,
  ) {
    const fields = { description, merchant: merchantRaw ?? '' };
    const match = rules.find((rule) => {
      const candidate = fields[rule.field as keyof typeof fields];
      if (!candidate) return false;
      const value = rule.value.toLowerCase();
      return (
        (rule.operator.toUpperCase() === 'CONTAINS' && candidate.toLowerCase().includes(value)) ||
        (rule.operator.toUpperCase() === 'EQUALS' && candidate.toLowerCase() === value)
      );
    });
    return match?.categoryId;
  }

  private async detectInternalTransfers(userId: string) {
    const rows = await this.prisma.transaction.findMany({
      where: { account: { connection: { userId } }, deletedAt: null, isTransfer: false },
      include: { account: { select: { id: true } } },
      orderBy: { postedAt: 'asc' },
      take: 5_000,
    });
    const inflows = rows.filter((row) => row.direction === 'INFLOW');
    const used = new Set<string>();
    for (const outflow of rows.filter((row) => row.direction === 'OUTFLOW')) {
      const counterpart = inflows.find(
        (inflow) =>
          !used.has(inflow.id) &&
          inflow.account.id !== outflow.account.id &&
          inflow.amount.eq(outflow.amount) &&
          Math.abs(inflow.postedAt.getTime() - outflow.postedAt.getTime()) <= 2 * DAY_MS,
      );
      if (!counterpart) continue;
      used.add(counterpart.id);
      await this.prisma.transaction.updateMany({
        where: { id: { in: [outflow.id, counterpart.id] } },
        data: { isTransfer: true },
      });
    }
  }
}
