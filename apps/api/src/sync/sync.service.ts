import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Decimal from 'decimal.js';
import {
  ConnectionStatus,
  DataProvider,
  DataQuality,
  Prisma,
  SyncRunStatus,
  WebhookEventStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PluggyAdapter } from '../integrations/pluggy/pluggy.adapter';
import { ProviderDataError } from '../integrations/pluggy/pluggy.adapter';
import { PluggyClientService } from '../integrations/pluggy/pluggy.client';
import { FinancialSummaryService } from '../finance-health/financial-summary.service';
import { normalizeMerchant } from './merchant-normalizer';
import { MetricsService } from '../observability/metrics.service';

const DAY_MS = 24 * 60 * 60 * 1000;

type SyncCounters = {
  accountsProcessed: number;
  transactionsProcessed: number;
  billsProcessed: number;
  investmentsProcessed: number;
  loansProcessed: number;
};

type SyncOutcome = {
  counters: SyncCounters;
  dataQuality: DataQuality;
  dataQualityReasons?: string[];
  connectionStatus?: ConnectionStatus;
  connectionError?: { code: string; message: string };
  persistSnapshot?: boolean;
};

type OptionalFetchResult<T> =
  | { status: 'AVAILABLE'; data: T[] }
  | { status: 'UNAVAILABLE'; data: null; reason: string };

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pluggy: PluggyClientService,
    private readonly adapter: PluggyAdapter,
    private readonly summary: FinancialSummaryService,
    private readonly metrics: MetricsService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async process(runId: string) {
    const startedAt = Date.now();
    const run = await this.prisma.syncRun.findUnique({
      where: { id: runId },
      include: { connection: true, webhookEvents: true },
    });
    if (!run || run.status !== SyncRunStatus.RUNNING) return;
    this.metrics.increment('sync_started_total');
    const webhookEvents = run.webhookEvents;
    const processedWebhookEventIds = webhookEvents.map((event) => event.id);
    const eventTypes = [
      ...new Set(
        [run.triggerEventType, ...webhookEvents.map((event) => event.eventType)]
          .filter((event): event is string => !!event)
          .map((event) => event.toLowerCase()),
      ),
    ];
    const deletedTransactionIds = this.deletedTransactionIds(
      webhookEvents,
      run.triggerEventType,
      run.resourceId,
    );
    const updatedTransactionIdsByAccount = new Map<string, string[]>();
    for (const event of webhookEvents) {
      if (event.eventType.toLowerCase() !== 'transactions/updated' || !event.providerAccountId)
        continue;
      const ids = updatedTransactionIdsByAccount.get(event.providerAccountId) ?? [];
      ids.push(...this.readStringArray(event.resourceIds));
      if (event.resourceId) ids.push(event.resourceId);
      updatedTransactionIdsByAccount.set(event.providerAccountId, [...new Set(ids)]);
    }
    try {
      await this.markWebhookEvents(
        processedWebhookEventIds,
        run.triggerEventId,
        WebhookEventStatus.PROCESSING,
      );
      const itemErrorCode =
        this.providerErrorCode(webhookEvents) ??
        (eventTypes.includes('item/error') ? run.errorCode : null);
      const outcome = eventTypes.includes('item/deleted')
        ? await this.handleItemDeleted()
        : eventTypes.includes('item/error')
          ? await this.handleItemError(itemErrorCode)
          : await this.syncConnection(
              run.connectionId,
              eventTypes,
              deletedTransactionIds,
              updatedTransactionIdsByAccount,
            );
      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: {
          ...outcome.counters,
          status: SyncRunStatus.SUCCEEDED,
          finishedAt: new Date(),
          nextAttemptAt: null,
          dataQuality: outcome.dataQuality,
          dataQualityReasons: outcome.dataQualityReasons,
        },
      });
      await this.prisma.connection.update({
        where: { id: run.connectionId },
        data: {
          status: outcome.connectionStatus ?? ConnectionStatus.CONNECTED,
          ...(outcome.connectionStatus
            ? {}
            : {
                lastSyncedAt: new Date(),
                lastErrorAt: null,
                lastErrorCode: null,
                lastErrorMessage: null,
              }),
          ...(outcome.connectionError
            ? {
                lastErrorAt: new Date(),
                lastErrorCode: outcome.connectionError.code,
                lastErrorMessage: outcome.connectionError.message,
              }
            : {}),
        },
      });
      await this.markWebhookEvents(
        processedWebhookEventIds,
        run.triggerEventId,
        WebhookEventStatus.PROCESSED,
      );
      if (outcome.persistSnapshot !== false) await this.summary.persistSnapshot(run.connection.userId);
      this.metrics.increment('sync_completed_total');
      this.metrics.observe('sync_duration_ms', Date.now() - startedAt);
    } catch (error) {
      const errorCode =
        error instanceof ProviderDataError ? 'PROVIDER_DATA_INVALID' : 'SYNC_FAILED';
      const errorRecord =
        error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
      const responseRecord =
        errorRecord.response && typeof errorRecord.response === 'object'
          ? (errorRecord.response as Record<string, unknown>)
          : {};
      const detailCode =
        typeof errorRecord.code === 'string'
          ? errorRecord.code
          : typeof responseRecord.code === 'string'
            ? responseRecord.code
            : 'UNKNOWN';
      const validationHint =
        error instanceof Prisma.PrismaClientValidationError
          ? error.message.match(
              /Unknown argument `[^`]+`|Argument `[^`]+` of type [^ ]+ is missing|Invalid value provided\. Expected [^\n]+/,
            )?.[0] ?? 'VALIDATION_ERROR'
          : null;
      const detailStatus = this.number(
        errorRecord.statusCode ?? errorRecord.status ?? responseRecord.status,
      );
      this.logger.error(
        `sync failed run=${run.id} connection=${run.connectionId} code=${errorCode} ` +
          `kind=${error instanceof Error ? error.name : typeof error} ` +
          `detail=${validationHint ?? detailCode} status=${detailStatus ?? 'UNKNOWN'}`,
      );
      if (this.shouldRetry(error, errorCode) && run.attempts < this.maxAttempts()) {
        const nextAttemptAt = new Date(Date.now() + this.backoffMs(run.attempts));
        await this.rescheduleTransientFailure(
          run,
          processedWebhookEventIds,
          nextAttemptAt,
        );
        this.metrics.increment('sync_retry_scheduled_total');
      } else {
        await this.prisma.syncRun.update({
          where: { id: run.id },
          data: {
            status: SyncRunStatus.FAILED,
            finishedAt: new Date(),
            errorCode,
            errorMessage: 'Sync failed after retry policy was exhausted',
          },
        });
        await this.prisma.connection.update({
          where: { id: run.connectionId },
          data: {
            status: ConnectionStatus.ERROR,
            lastErrorAt: new Date(),
            lastErrorCode: errorCode,
            lastErrorMessage: 'Sincronização indisponível',
          },
        });
        await this.markWebhookEvents(
          processedWebhookEventIds,
          run.triggerEventId,
          WebhookEventStatus.FAILED,
          errorCode,
        );
        this.metrics.increment('sync_failed_total');
      }
      this.metrics.observe('sync_duration_ms', Date.now() - startedAt);
    }
  }

  private async rescheduleTransientFailure(
    run: { id: string; connectionId: string; attempts: number },
    processedWebhookEventIds: string[],
    nextAttemptAt: Date,
  ) {
    for (let transactionAttempt = 0; transactionAttempt < 3; transactionAttempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const queued = await tx.syncRun.findFirst({
            where: {
              connectionId: run.connectionId,
              status: SyncRunStatus.QUEUED,
              id: { not: run.id },
            },
            orderBy: { createdAt: 'asc' },
          });
          const retryError =
            'Temporary failure; retry coalesced into queued run';

          if (queued) {
            if (processedWebhookEventIds.length) {
              await tx.webhookEvent.updateMany({
                where: {
                  provider: DataProvider.PLUGGY,
                  id: { in: processedWebhookEventIds },
                },
                data: {
                  syncRunId: queued.id,
                  status: WebhookEventStatus.RECEIVED,
                  processedAt: null,
                  lastError: 'SYNC_RETRY_SCHEDULED',
                },
              });
            }
            await tx.syncRun.update({
              where: { id: queued.id },
              data: {
                nextAttemptAt: queued.nextAttemptAt
                  ? new Date(Math.min(queued.nextAttemptAt.getTime(), nextAttemptAt.getTime()))
                  : null,
                errorCode: 'SYNC_RETRY_COALESCED',
                errorMessage: retryError,
              },
            });
            await tx.syncRun.update({
              where: { id: run.id },
              data: {
                status: SyncRunStatus.FAILED,
                finishedAt: new Date(),
                nextAttemptAt: null,
                errorCode: 'SYNC_RETRY_COALESCED',
                errorMessage: retryError,
              },
            });
            await tx.connection.update({
              where: { id: run.connectionId },
              data: { status: ConnectionStatus.PENDING },
            });
            return { coalesced: true, queuedRunId: queued.id };
          }

          await tx.syncRun.update({
            where: { id: run.id },
            data: {
              status: SyncRunStatus.QUEUED,
              finishedAt: null,
              nextAttemptAt,
              errorCode: 'SYNC_FAILED',
              errorMessage: 'Temporary sync failure; retry scheduled',
            },
          });
          if (processedWebhookEventIds.length) {
            await tx.webhookEvent.updateMany({
              where: {
                provider: DataProvider.PLUGGY,
                id: { in: processedWebhookEventIds },
              },
              data: {
                status: WebhookEventStatus.RECEIVED,
                processedAt: null,
                lastError: 'SYNC_RETRY_SCHEDULED',
              },
            });
          }
          await tx.connection.update({
            where: { id: run.connectionId },
            data: { status: ConnectionStatus.PENDING },
          });
          return { coalesced: false, queuedRunId: run.id };
        });
      } catch (error) {
        if (!this.isUniqueConstraintError(error) || transactionAttempt === 2) throw error;
      }
    }
    throw new Error('Transient sync retry could not be scheduled');
  }

  private async syncConnection(
    connectionId: string,
    eventTypes: string[],
    deletedTransactionIds: string[],
    updatedTransactionIdsByAccount: Map<string, string[]>,
  ): Promise<SyncOutcome> {
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
    let optionalDataUnavailable = false;
    const dataQualityReasons: string[] = [];
    if (!providerAccounts.length) {
      optionalDataUnavailable = true;
      dataQualityReasons.push('ACCOUNTS_UNAVAILABLE');
    }

    for (const rawAccount of providerAccounts) {
      const mappedAccount = this.adapter.mapAccount(rawAccount);
      if (!mappedAccount.currency) {
        optionalDataUnavailable = true;
        dataQualityReasons.push('ACCOUNT_CURRENCY_UNAVAILABLE');
      }
      if (mappedAccount.currentBalance === null && mappedAccount.availableBalance === null) {
        optionalDataUnavailable = true;
        dataQualityReasons.push('ACCOUNT_BALANCE_UNAVAILABLE');
      }
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
        const billsResult = await this.optional('bills', () =>
          this.pluggy.fetchBills(mappedAccount.providerAccountId),
        );
        if (billsResult.status === 'UNAVAILABLE') {
          optionalDataUnavailable = true;
          dataQualityReasons.push(billsResult.reason);
        }
        if (billsResult.status === 'AVAILABLE') {
          for (const rawBill of billsResult.data) {
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
      }

      const updatedIds = updatedTransactionIdsByAccount.get(mappedAccount.providerAccountId) ?? [];
      const providerTransactions = this.shouldUseTargetedTransactionFetch(eventTypes, updatedIds)
        ? await this.pluggy.fetchTransactionsByIds(mappedAccount.providerAccountId, updatedIds)
        : await this.pluggy.fetchAllTransactions(mappedAccount.providerAccountId, dateFrom);
      const normalizedTransactions = providerTransactions.map((raw) =>
        this.adapter.mapTransaction(raw),
      );
      const recurringIds = this.recurringTransactionIds(normalizedTransactions);
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
            isRecurringCandidate: recurringIds.has(transaction.providerTransactionId),
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
            isRecurringCandidate: recurringIds.has(transaction.providerTransactionId),
            deletedAt: null,
          },
        });
        this.metrics.increment('transactions_upserted_total');
        transactionsProcessed += 1;
      }
    }

    if (eventTypes.includes('transactions/deleted') && deletedTransactionIds.length) {
      await this.prisma.transaction.updateMany({
        where: {
          provider: DataProvider.PLUGGY,
          providerTransactionId: { in: deletedTransactionIds },
          account: { connectionId },
        },
        data: { deletedAt: syncAt },
      });
    }

    const investmentsResult = await this.optional('investments', () =>
      this.pluggy.fetchInvestments(connection.providerItemId),
    );
    if (investmentsResult.status === 'UNAVAILABLE') {
      optionalDataUnavailable = true;
      dataQualityReasons.push(investmentsResult.reason);
    }
    if (investmentsResult.status === 'AVAILABLE') {
      for (const rawInvestment of investmentsResult.data) {
        const investment = this.adapter.mapInvestment(rawInvestment);
        const persisted = await this.prisma.investment.upsert({
          where: {
            connectionId_provider_providerInvestmentId: {
              connectionId,
              provider: DataProvider.PLUGGY,
              providerInvestmentId: investment.providerInvestmentId,
            },
          },
          create: {
            connectionId,
            provider: DataProvider.PLUGGY,
            providerInvestmentId: investment.providerInvestmentId,
            type: investment.type,
            name: investment.name,
            currency: investment.currency,
          },
          update: {
            type: investment.type,
            name: investment.name,
            currency: investment.currency,
          },
        });
        await this.prisma.investmentSnapshot.upsert({
          where: { investmentId_snapshotAt: { investmentId: persisted.id, snapshotAt: syncAt } },
          create: { investmentId: persisted.id, snapshotAt: syncAt, balance: investment.balance },
          update: { balance: investment.balance },
        });
      }
    }

    const loansResult = await this.optional('loans', () =>
      this.pluggy.fetchLoans(connection.providerItemId),
    );
    if (loansResult.status === 'UNAVAILABLE') {
      optionalDataUnavailable = true;
      dataQualityReasons.push(loansResult.reason);
    }
    if (loansResult.status === 'AVAILABLE') {
      for (const rawLoan of loansResult.data) {
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
    }

    await this.detectInternalTransfers(connection.userId);

    return {
      counters: {
        accountsProcessed,
        transactionsProcessed,
        billsProcessed,
        investmentsProcessed: investmentsResult.data?.length ?? 0,
        loansProcessed: loansResult.data?.length ?? 0,
      },
      dataQuality: optionalDataUnavailable ? DataQuality.PARTIAL : DataQuality.COMPLETE,
      dataQualityReasons: [...new Set(dataQualityReasons)],
    };
  }

  private async optional<T>(label: string, operation: () => Promise<T[]>): Promise<OptionalFetchResult<T>> {
    try {
      return { status: 'AVAILABLE', data: await operation() };
    } catch {
      this.metrics.increment(`sync_optional_${label}_unavailable_total`);
      return {
        status: 'UNAVAILABLE',
        data: null,
        reason: `${label.toUpperCase()}_UNAVAILABLE`,
      };
    }
  }

  private async handleItemDeleted(): Promise<SyncOutcome> {
    return {
      counters: {
        accountsProcessed: 0,
        transactionsProcessed: 0,
        billsProcessed: 0,
        investmentsProcessed: 0,
        loansProcessed: 0,
      },
      dataQuality: DataQuality.UNAVAILABLE,
      dataQualityReasons: ['ITEM_DELETED'],
      connectionStatus: ConnectionStatus.DISCONNECTED,
      connectionError: {
        code: 'ITEM_DELETED',
        message: 'A conexão foi removida pelo provedor.',
      },
      persistSnapshot: false,
    };
  }

  private async handleItemError(
    providerErrorCode: string | null,
  ): Promise<SyncOutcome> {
    const code = providerErrorCode ?? 'PROVIDER_ITEM_ERROR';
    const status = this.requiresReauthentication(code)
      ? ConnectionStatus.REAUTH_REQUIRED
      : ConnectionStatus.ERROR;
    return {
      counters: {
        accountsProcessed: 0,
        transactionsProcessed: 0,
        billsProcessed: 0,
        investmentsProcessed: 0,
        loansProcessed: 0,
      },
      dataQuality: DataQuality.STALE,
      dataQualityReasons: [code],
      connectionStatus: status,
      connectionError: {
        code,
        message:
          status === ConnectionStatus.REAUTH_REQUIRED
            ? 'A conexão precisa ser autorizada novamente.'
            : 'A instituição reportou um erro na sincronização.',
      },
      persistSnapshot: false,
    };
  }

  private requiresReauthentication(code: string) {
    return new Set([
      'REAUTH_REQUIRED',
      'LOGIN_ERROR',
      'INVALID_CREDENTIALS',
      'USER_AUTHORIZATION_PENDING',
      'USER_INPUT_TIMEOUT',
      'PARAMETERS_NOT_PROVIDED',
    ]).has(code.toUpperCase());
  }

  private providerErrorCode(events: Array<{ providerErrorCode: string | null }>) {
    return events.find((event) => event.providerErrorCode)?.providerErrorCode ?? null;
  }

  private async markWebhookEvents(
    processedWebhookEventIds: string[],
    legacyEventId: string | null,
    status: WebhookEventStatus,
    lastError?: string,
  ) {
    const where: Prisma.WebhookEventWhereInput = {
      provider: DataProvider.PLUGGY,
      OR: [
        ...(processedWebhookEventIds.length ? [{ id: { in: processedWebhookEventIds } }] : []),
        ...(legacyEventId ? [{ eventId: legacyEventId }] : []),
      ],
    };
    const data: Prisma.WebhookEventUpdateManyMutationInput = { status };
    if (status === WebhookEventStatus.PROCESSING)
      data.attempts = { increment: 1 };
    if (status === WebhookEventStatus.PROCESSED || status === WebhookEventStatus.FAILED)
      data.processedAt = new Date();
    if (status === WebhookEventStatus.RECEIVED) data.processedAt = null;
    if (lastError !== undefined) data.lastError = lastError;
    await this.prisma.webhookEvent.updateMany({ where, data });
  }

  private readStringArray(value: Prisma.JsonValue | null) {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim());
  }

  private deletedTransactionIds(
    events: Array<{
      eventType: string;
      resourceId: string | null;
      resourceIds: Prisma.JsonValue | null;
    }>,
    triggerEventType: string | null,
    triggerResourceId: string | null,
  ) {
    return [
      ...new Set([
        ...events
          .filter((event) => event.eventType.toLowerCase() === 'transactions/deleted')
          .flatMap((event) => this.readStringArray(event.resourceIds)),
        ...events
          .filter((event) => event.eventType.toLowerCase() === 'transactions/deleted')
          .map((event) => event.resourceId)
          .filter((id): id is string => !!id),
        ...(triggerEventType?.toLowerCase() === 'transactions/deleted' && triggerResourceId
          ? [triggerResourceId]
          : []),
      ]),
    ];
  }

  private shouldUseTargetedTransactionFetch(eventTypes: string[], updatedIds: string[]) {
    if (!updatedIds.length) return false;
    return !eventTypes.some((eventType) =>
      [
        'transactions/created',
        'item/created',
        'item/updated',
        'accounts/updated',
      ].includes(eventType),
    );
  }

  private maxAttempts() {
    return Math.max(1, this.config?.get<number>('SYNC_MAX_ATTEMPTS', 3) ?? 3);
  }

  private backoffMs(attempts: number) {
    const base = Math.max(100, this.config?.get<number>('SYNC_RETRY_BASE_MS', 5_000) ?? 5_000);
    const maximum = Math.max(base, this.config?.get<number>('SYNC_RETRY_MAX_MS', 300_000) ?? 300_000);
    return Math.min(maximum, base * 2 ** Math.max(0, attempts - 1));
  }

  private shouldRetry(error: unknown, errorCode: string) {
    if (errorCode === 'PROVIDER_DATA_INVALID') return false;
    const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
    const response = record.response && typeof record.response === 'object'
      ? (record.response as Record<string, unknown>)
      : {};
    const status = this.number(record.statusCode ?? record.status ?? response.status);
    if (status === undefined) return true;
    if (status === 408 || status === 409 || status === 425 || status === 429) return true;
    return status >= 500;
  }

  private isUniqueConstraintError(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === 'P2002';
    return (
      !!error &&
      typeof error === 'object' &&
      (error as Record<string, unknown>).code === 'P2002'
    );
  }

  private number(value: unknown) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
    return undefined;
  }

  private recurringTransactionIds(
    transactions: Array<{
      providerTransactionId: string;
      merchantRaw: string | null;
      description: string;
      amount: string;
      direction: 'INFLOW' | 'OUTFLOW';
      postedAt: Date;
      isTransfer: boolean;
      installmentTotal: number | null;
    }>,
  ) {
    const groups = new Map<string, typeof transactions>();
    for (const transaction of transactions) {
      if (transaction.isTransfer || (transaction.installmentTotal ?? 0) > 1) continue;
      const merchant = normalizeMerchant(transaction.merchantRaw ?? transaction.description);
      if (!merchant || merchant.length < 3) continue;
      const key = `${merchant}|${transaction.direction}`;
      groups.set(key, [...(groups.get(key) ?? []), transaction]);
    }

    const recurringIds = new Set<string>();
    for (const group of groups.values()) {
      const ordered = [...group].sort((left, right) => left.postedAt.getTime() - right.postedAt.getTime());
      for (let index = 1; index < ordered.length; index += 1) {
        const previous = ordered[index - 1];
        const current = ordered[index];
        const days = (current.postedAt.getTime() - previous.postedAt.getTime()) / DAY_MS;
        if (!this.isRecurringCadence(days) || !this.isSimilarAmount(previous.amount, current.amount))
          continue;
        recurringIds.add(previous.providerTransactionId);
        recurringIds.add(current.providerTransactionId);
      }
    }
    return recurringIds;
  }

  private isRecurringCadence(days: number) {
    return [
      [5, 9],
      [12, 16],
      [25, 35],
      [80, 100],
    ].some(([min, max]) => days >= min && days <= max);
  }

  private isSimilarAmount(left: string, right: string) {
    try {
      const first = new Decimal(left);
      const second = new Decimal(right);
      const difference = first.minus(second).abs();
      const tolerance = Decimal.max(new Decimal('2.00'), Decimal.min(first.abs(), second.abs()).mul('0.10'));
      return difference.lte(tolerance);
    } catch {
      return false;
    }
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
      include: { account: { select: { id: true, currency: true } } },
      orderBy: { postedAt: 'asc' },
      take: 5_000,
    });
    const inflows = rows.filter((row) => row.direction === 'INFLOW');
    const used = new Set<string>();
    for (const outflow of rows.filter((row) => row.direction === 'OUTFLOW')) {
      if (!this.hasTransferSignal(outflow.description, outflow.merchantRaw)) continue;
      const counterpart = inflows
        .filter(
          (inflow) =>
            !used.has(inflow.id) &&
            inflow.account.id !== outflow.account.id &&
            !!outflow.account.currency &&
            outflow.account.currency === inflow.account.currency &&
            inflow.amount.eq(outflow.amount) &&
            Math.abs(inflow.postedAt.getTime() - outflow.postedAt.getTime()) <= DAY_MS &&
            this.hasTransferSignal(inflow.description, inflow.merchantRaw),
        )
        .sort(
          (left, right) =>
            Math.abs(left.postedAt.getTime() - outflow.postedAt.getTime()) -
            Math.abs(right.postedAt.getTime() - outflow.postedAt.getTime()),
        )[0];
      if (!counterpart) continue;
      used.add(counterpart.id);
      await this.prisma.transaction.updateMany({
        where: { id: { in: [outflow.id, counterpart.id] } },
        data: { isTransfer: true },
      });
    }
  }

  private hasTransferSignal(description: string, merchantRaw: string | null) {
    const text = `${description} ${merchantRaw ?? ''}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return /\b(?:pix|ted|doc|transfer(?:encia)?|transf|envio|recebimento|deposito|movimentacao)\b/.test(
      text,
    );
  }
}
