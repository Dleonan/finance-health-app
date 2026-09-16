import { Injectable } from '@nestjs/common';
import type { Confidence, Prisma } from '@prisma/client';
import { DataAvailability, DataQuality } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../database/prisma.service';
import { FinanceHealthService } from './finance-health.service';
import type { FinancialHealthInputs, MetricMeta } from './finance-health.service';
import { getUserMonthWindow } from './time-window';

const DAY_MS = 24 * 60 * 60 * 1000;
const zero = () => new Decimal(0);

type LatestSyncRun = {
  status: string;
  dataQuality: DataQuality | null;
  dataQualityReasons: Prisma.JsonValue | null;
};

type SummaryConnection = {
  status: string;
  syncRuns: LatestSyncRun[];
};

@Injectable()
export class FinancialSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: FinanceHealthService,
  ) {}

  async getSummary(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const now = new Date();
    const month = getUserMonthWindow(now, user.timezone);
    const next30 = new Date(now.getTime() + 30 * DAY_MS);
    const historyStart = new Date(month.start.getTime() - 6 * 31 * DAY_MS);
    const [connections, accounts, investments, loans, bills, transactions, historicalTransactions, fact] =
      await Promise.all([
        this.prisma.connection.findMany({
          where: { userId },
          select: {
            status: true,
            syncRuns: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { status: true, dataQuality: true, dataQualityReasons: true },
            },
          },
        }),
        this.prisma.account.findMany({
          where: { connection: { userId } },
          include: {
            connection: {
              include: {
                syncRuns: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                  select: { status: true, dataQuality: true, dataQualityReasons: true },
                },
              },
            },
          },
        }),
        this.prisma.investment.findMany({
          where: { connection: { userId } },
          include: { snapshots: { orderBy: { snapshotAt: 'desc' }, take: 1 } },
        }),
        this.prisma.loan.findMany({ where: { connection: { userId } } }),
        this.prisma.creditCardBill.findMany({
          where: { account: { connection: { userId } }, status: { not: 'PAID' } },
          include: { account: { select: { currency: true } } },
        }),
        this.prisma.transaction.findMany({
          where: {
            account: { connection: { userId } },
            deletedAt: null,
            postedAt: { gte: month.start, lt: month.end },
          },
          include: { account: { select: { currency: true } } },
        }),
        this.prisma.transaction.findMany({
          where: {
            account: { connection: { userId }, currency: user.baseCurrency },
            deletedAt: null,
            isTransfer: false,
            postedAt: { gte: historyStart, lt: month.start },
          },
          select: { postedAt: true, direction: true, amount: true },
        }),
        this.prisma.manualFact.findUnique({
          where: { userId_key: { userId, key: 'essentialMonthlyExpenses' } },
        }),
      ]);

    const sourceAvailability = this.sourceAvailability(connections);
    const baseCurrencyAccounts = accounts.filter(
      (account) => account.currency === user.baseCurrency,
    );
    const cardAccounts = accounts.filter((account) => account.kind === 'CREDIT_CARD');
    const hasUnknownCardCurrency = cardAccounts.some((account) => account.currency === null);
    const hasUnknownTransactionCurrency = transactions.some(
      (transaction) => transaction.account.currency === null,
    );
    const accountsAvailable =
      accounts.length > 0 && sourceAvailability.accounts &&
      !this.hasSourceUnavailableReason(connections, 'ACCOUNTS_UNAVAILABLE');
    const transactionsAvailable =
      accountsAvailable && sourceAvailability.transactions && !hasUnknownTransactionCurrency;
    const billsAvailable = sourceAvailability.bills && !hasUnknownCardCurrency;
    const investmentsAvailable =
      sourceAvailability.investments && !investments.some((investment) => investment.currency === null);
    const loansAvailable =
      sourceAvailability.loans && !loans.some((loan) => loan.currency === null);
    const liquidAssets = this.sumKnown(
      accountsAvailable && baseCurrencyAccounts.length > 0
        ? baseCurrencyAccounts
            .filter((account) => ['CHECKING', 'SAVINGS', 'OTHER'].includes(account.kind))
            .map((account) => account.availableBalance ?? account.currentBalance)
        : [],
    );
    const totalBalance = this.sumKnown(
      accountsAvailable && baseCurrencyAccounts.length > 0
        ? baseCurrencyAccounts.map((account) => account.currentBalance)
        : [],
    );
    const investedAssets = this.sumKnown(
      investmentsAvailable
        ? investments
            .filter((investment) => investment.currency === user.baseCurrency)
            .map((investment) => investment.snapshots[0]?.balance)
        : [],
      investmentsAvailable ? zero() : null,
    );
    const baseCurrencyBills = bills.filter((bill) => bill.account.currency === user.baseCurrency);
    const baseCurrencyTransactions = transactions.filter(
      (transaction) => transaction.account.currency === user.baseCurrency,
    );
    const baseCurrencyLoans = loans.filter((loan) => loan.currency === user.baseCurrency);
    const cardExposure = !cardAccounts.length
      ? zero()
      : this.sumKnown(
          billsAvailable ? baseCurrencyBills.map((bill) => bill.totalAmount) : [],
          billsAvailable ? zero() : null,
        );
    const loanLiabilities = this.sumKnown(
      loansAvailable ? baseCurrencyLoans.map((loan) => loan.outstandingBalance) : [],
      loansAvailable ? zero() : null,
    );
    const liabilities = this.addKnown(cardExposure, loanLiabilities);
    const monthlyIncome = this.sumKnown(
      transactionsAvailable
        ? baseCurrencyTransactions
            .filter((transaction) => transaction.direction === 'INFLOW' && !transaction.isTransfer)
            .map((transaction) => transaction.amount)
        : [],
      transactionsAvailable ? zero() : null,
    );
    const monthlyExpenses = this.sumKnown(
      transactionsAvailable
        ? baseCurrencyTransactions
            .filter((transaction) => transaction.direction === 'OUTFLOW' && !transaction.isTransfer)
            .map((transaction) => transaction.amount)
        : [],
      transactionsAvailable ? zero() : null,
    );
    const upcomingValues = [
      ...baseCurrencyBills
        .filter((bill) => bill.dueDate >= now && bill.dueDate < next30)
        .map((bill) => bill.totalAmount),
      ...baseCurrencyLoans
        .filter(
          (loan) => loan.nextDueDate && loan.nextDueDate >= now && loan.nextDueDate < next30,
        )
        .map((loan) => loan.installment),
    ];
    const upcomingAvailable = billsAvailable && loansAvailable;
    const upcomingCommitments = this.sumKnown(
      upcomingAvailable ? upcomingValues : [],
      upcomingAvailable ? zero() : null,
    );
    const debtService = this.sumKnown(
      loansAvailable ? baseCurrencyLoans.map((loan) => loan.installment) : [],
      loansAvailable ? zero() : null,
    );
    const cardLimit = this.sumKnown(
      cardAccounts.length && billsAvailable
        ? baseCurrencyAccounts
            .filter((account) => account.kind === 'CREDIT_CARD')
            .map((account) => account.creditLimit)
        : [],
      !cardAccounts.length || (billsAvailable && !hasUnknownCardCurrency) ? zero() : null,
    );
    const hasLiquidAssets = liquidAssets !== null;
    const hasCurrentTransactions = transactionsAvailable;
    const hasDebtService = debtService !== null;
    const hasUpcomingCommitments = upcomingCommitments !== null;
    const hasCardLimit = cardLimit !== null;
    const hasUnknownCurrency =
      accounts.some((account) => account.currency === null) ||
      investments.some((investment) => investment.currency === null) ||
      loans.some((loan) => loan.currency === null);
    const monthlyHistory = this.monthlyHistory(historicalTransactions, user.timezone);
    const incomeVolatility = this.volatility(monthlyHistory.map((month) => month.income));
    const essentialExpenseVolatility = this.volatility(
      monthlyHistory.map((month) => month.expenses),
    );
    const historyMonths = monthlyHistory.length;
    const dataQuality = this.quality(
      accounts,
      baseCurrencyAccounts,
      hasUnknownCurrency,
    );
    const dataQualityReasons = this.qualityReasons(accounts, baseCurrencyAccounts, hasUnknownCurrency);
    const observedMeta = (sources: string[], quality: DataQuality = dataQuality): MetricMeta => ({
      availability: quality === DataQuality.STALE ? 'STALE' : 'AVAILABLE',
      quality,
      provenance: 'OBSERVED',
      sources,
      window: `${month.start.toISOString()}..${month.end.toISOString()}`,
    });
    const unavailableMeta = (sources: string[]): MetricMeta => ({
      availability: 'UNAVAILABLE',
      quality: 'UNAVAILABLE',
      provenance: 'OBSERVED',
      sources,
      window: `${month.start.toISOString()}..${month.end.toISOString()}`,
    });
    const essentialMeta: MetricMeta =
      fact?.value !== null && fact?.value !== undefined
        ? {
            availability: 'AVAILABLE',
            quality: 'ESTIMATED',
            provenance: 'USER_DECLARED',
            sources: ['manualFacts.essentialMonthlyExpenses'],
            window: 'current-period',
          }
        : hasCurrentTransactions
          ? {
              availability: 'AVAILABLE',
              quality: 'ESTIMATED',
              provenance: 'ESTIMATED',
              sources: ['transactions.current-month'],
              window: `${month.start.toISOString()}..${month.end.toISOString()}`,
            }
          : unavailableMeta(['transactions.current-month']);
    const input: FinancialHealthInputs = {
      monthlyIncome: hasCurrentTransactions ? (monthlyIncome?.toFixed(2) ?? null) : null,
      monthlyExpenses: hasCurrentTransactions ? (monthlyExpenses?.toFixed(2) ?? null) : null,
      essentialMonthlyExpenses:
        fact?.value !== null && fact?.value !== undefined
          ? fact.value.toFixed(2)
          : hasCurrentTransactions
            ? (monthlyExpenses?.toFixed(2) ?? null)
            : null,
      liquidAssets: hasLiquidAssets ? (liquidAssets?.toFixed(2) ?? null) : null,
      monthlyDebtService: hasDebtService ? (debtService?.toFixed(2) ?? null) : null,
      revolvingOrCardBalance: cardExposure?.toFixed(2) ?? null,
      totalCardLimit: hasCardLimit ? cardLimit.toFixed(2) : null,
      upcoming30dCommitments: hasUpcomingCommitments ? upcomingCommitments.toFixed(2) : null,
      incomeVolatility: incomeVolatility?.toFixed(4) ?? null,
      essentialExpenseVolatility: essentialExpenseVolatility?.toFixed(4) ?? null,
      historyMonths,
      meta: {
        monthlyIncome: hasCurrentTransactions
          ? observedMeta(['transactions.current-month'])
          : unavailableMeta(['transactions.current-month']),
        monthlyExpenses: hasCurrentTransactions
          ? observedMeta(['transactions.current-month'])
          : unavailableMeta(['transactions.current-month']),
        essentialMonthlyExpenses: essentialMeta,
        liquidAssets: hasLiquidAssets
          ? observedMeta(['accounts.availableBalance', 'accounts.currentBalance'])
          : unavailableMeta(['accounts.availableBalance', 'accounts.currentBalance']),
        monthlyDebtService: hasDebtService
          ? observedMeta(['loans.installment'])
          : unavailableMeta(['loans.installment']),
        revolvingOrCardBalance: baseCurrencyBills.length
          ? observedMeta(['creditCardBills.totalAmount'])
          : unavailableMeta(['creditCardBills.totalAmount']),
        totalCardLimit: hasCardLimit
          ? observedMeta(['accounts.creditLimit'])
          : unavailableMeta(['accounts.creditLimit']),
        upcoming30dCommitments: hasUpcomingCommitments
          ? observedMeta(['creditCardBills.dueDate', 'loans.nextDueDate'])
          : unavailableMeta(['creditCardBills.dueDate', 'loans.nextDueDate']),
        incomeVolatility: incomeVolatility
          ? observedMeta(['transactions.history'])
          : unavailableMeta(['transactions.history']),
        essentialExpenseVolatility: essentialExpenseVolatility
          ? observedMeta(['transactions.history'])
          : unavailableMeta(['transactions.history']),
      },
    };
    const financialHealth = this.health.calculate(input);
    const netWorth =
      liquidAssets !== null && investedAssets !== null && liabilities !== null
        ? liquidAssets.plus(investedAssets).minus(liabilities)
        : null;
    return {
      availableCash: this.formatDecimal(liquidAssets),
      totalBalance: this.formatDecimal(totalBalance),
      investments: this.formatDecimal(investedAssets),
      liabilities: this.formatDecimal(liabilities),
      netWorth: this.formatDecimal(netWorth),
      monthlyIncome: this.formatDecimal(monthlyIncome),
      monthlyExpenses: this.formatDecimal(monthlyExpenses),
      creditCardExposure: this.formatDecimal(cardExposure),
      upcomingCommitments: this.formatDecimal(upcomingCommitments),
      financialHealth,
      dataQuality,
      dataQualityReasons,
      lastSyncedAt: this.latestSync(accounts),
      currency: user.baseCurrency,
    };
  }

  async persistSnapshot(userId: string) {
    const summary = await this.getSummary(userId);
    const snapshotAt = new Date();
    await this.prisma.financialSnapshot.create({
      data: {
        userId,
        snapshotAt,
        liquidAssets: summary.availableCash,
        investedAssets: summary.investments,
        liabilities: summary.liabilities,
        netWorth: summary.netWorth,
        monthlyIncome: summary.monthlyIncome,
        monthlyExpenses: summary.monthlyExpenses,
        dataQuality: summary.dataQuality,
      },
    });
    await this.prisma.financialHealthAssessment.create({
      data: {
        userId,
        calculatedAt: snapshotAt,
        score: summary.financialHealth.score,
        coverage: summary.financialHealth.coverage.toFixed(4),
        confidence: summary.financialHealth.confidence as Confidence,
        status:
          summary.financialHealth.status === 'AVAILABLE'
            ? DataAvailability.AVAILABLE
            : DataAvailability.INSUFFICIENT_DATA,
        version: summary.financialHealth.version,
        components: summary.financialHealth.components as Prisma.InputJsonValue,
      },
    });
    return summary;
  }

  async current(userId: string) {
    return (await this.getSummary(userId)).financialHealth;
  }

  history(userId: string) {
    return this.prisma.financialHealthAssessment
      .findMany({
        where: { userId },
        orderBy: { calculatedAt: 'desc' },
        take: 90,
        select: {
          calculatedAt: true,
          score: true,
          coverage: true,
          confidence: true,
          status: true,
          version: true,
          components: true,
        },
      })
      .then((rows) => rows.map((row) => ({ ...row, coverage: row.coverage.toFixed(4) })));
  }

  private quality(
    accounts: Array<{
      currency: string | null;
      connection: {
        status: string;
        syncRuns: Array<{ status: string; dataQuality: DataQuality | null }>;
      };
    }>,
    baseCurrencyAccounts: Array<unknown>,
    hasUnknownCurrency: boolean,
  ) {
    if (!accounts.length) return DataQuality.UNAVAILABLE;
    if (
      accounts.some((account) =>
        ['STALE', 'ERROR', 'REAUTH_REQUIRED', 'DISCONNECTED'].includes(account.connection.status),
      )
    )
      return DataQuality.STALE;
    if (accounts.some((account) => ['PENDING', 'SYNCING'].includes(account.connection.status)))
      return DataQuality.PARTIAL;
    if (hasUnknownCurrency || baseCurrencyAccounts.length !== accounts.length)
      return DataQuality.PARTIAL;
    const syncRuns = accounts
      .flatMap((account) => account.connection.syncRuns)
      .filter((run): run is { status: string; dataQuality: DataQuality | null } => !!run);
    if (
      !syncRuns.length ||
      syncRuns.some((run) => run.status !== 'SUCCEEDED' || run.dataQuality !== DataQuality.COMPLETE)
    )
      return DataQuality.PARTIAL;
    return DataQuality.COMPLETE;
  }

  private sourceAvailability(connections: SummaryConnection[]) {
    return {
      accounts: this.isSourceAvailable(connections, 'ACCOUNTS_UNAVAILABLE'),
      transactions: this.isSourceAvailable(connections, 'ACCOUNTS_UNAVAILABLE'),
      bills: this.isSourceAvailable(connections, 'BILLS_UNAVAILABLE'),
      investments: this.isSourceAvailable(connections, 'INVESTMENTS_UNAVAILABLE'),
      loans: this.isSourceAvailable(connections, 'LOANS_UNAVAILABLE'),
    };
  }

  private isSourceAvailable(connections: SummaryConnection[], unavailableReason: string) {
    if (!connections.length) return false;
    return connections.every((connection) => {
      if (connection.status !== 'CONNECTED') return false;
      const run = connection.syncRuns[0];
      if (!run || run.status !== 'SUCCEEDED') return false;
      if (run.dataQuality === DataQuality.STALE || run.dataQuality === DataQuality.UNAVAILABLE)
        return false;
      return !this.hasSourceUnavailableReason([connection], unavailableReason);
    });
  }

  private hasSourceUnavailableReason(
    connections: SummaryConnection[],
    unavailableReason: string,
  ) {
    return connections.some((connection) =>
      connection.syncRuns.some((run) =>
        Array.isArray(run.dataQualityReasons) &&
        run.dataQualityReasons.some((reason) => reason === unavailableReason),
      ),
    );
  }

  private sumKnown(
    values: Array<Decimal | Prisma.Decimal | null | undefined>,
    knownEmpty: Decimal | null = null,
  ): Decimal | null {
    if (!values.length) return knownEmpty;
    if (values.some((value) => value === null || value === undefined)) return null;
    return values.reduce<Decimal>((sum, value) => sum.plus(String(value)), zero());
  }

  private addKnown(left: Decimal | null, right: Decimal | null) {
    if (left === null || right === null) return null;
    return left.plus(right);
  }

  private formatDecimal(value: Decimal | null) {
    return value?.toFixed(2) ?? null;
  }

  private qualityReasons(
    accounts: Array<{
      currency: string | null;
      connection: {
        status: string;
        syncRuns: Array<{ status: string; dataQuality: DataQuality | null; dataQualityReasons: Prisma.JsonValue | null }>;
      };
    }>,
    baseCurrencyAccounts: Array<unknown>,
    hasUnknownCurrency: boolean,
  ) {
    const reasons = new Set<string>();
    if (!accounts.length) reasons.add('NO_ACCOUNTS');
    if (hasUnknownCurrency) reasons.add('CURRENCY_UNAVAILABLE');
    if (baseCurrencyAccounts.length !== accounts.length) reasons.add('BASE_CURRENCY_MISMATCH');
    for (const account of accounts) {
      if (['STALE', 'ERROR', 'REAUTH_REQUIRED', 'DISCONNECTED'].includes(account.connection.status))
        reasons.add(`CONNECTION_${account.connection.status}`);
      for (const run of account.connection.syncRuns) {
        if (Array.isArray(run.dataQualityReasons)) {
          for (const reason of run.dataQualityReasons) {
            if (typeof reason === 'string') reasons.add(reason);
          }
        }
        if (run.status !== 'SUCCEEDED') reasons.add('SYNC_NOT_COMPLETED');
        if (run.dataQuality && run.dataQuality !== DataQuality.COMPLETE)
          reasons.add(`SYNC_${run.dataQuality}`);
      }
    }
    if (accounts.length && !accounts.some((account) => account.connection.syncRuns.length))
      reasons.add('NO_COMPLETED_SYNC');
    return [...reasons];
  }

  private monthlyHistory(
    transactions: Array<{
      postedAt: Date;
      direction: string;
      amount: Prisma.Decimal;
    }>,
    timezone: string,
  ) {
    const byMonth = new Map<string, { income: Decimal; expenses: Decimal }>();
    for (const transaction of transactions) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
      }).formatToParts(transaction.postedAt);
      const year = parts.find((part) => part.type === 'year')?.value ?? 'unknown';
      const month = parts.find((part) => part.type === 'month')?.value ?? 'unknown';
      const key = `${year}-${month}`;
      const current = byMonth.get(key) ?? { income: zero(), expenses: zero() };
      if (transaction.direction === 'INFLOW')
        current.income = current.income.plus(transaction.amount);
      if (transaction.direction === 'OUTFLOW')
        current.expenses = current.expenses.plus(transaction.amount);
      byMonth.set(key, current);
    }
    return [...byMonth.values()];
  }

  private volatility(values: Decimal[]) {
    if (values.length < 3) return null;
    const mean = values.reduce((sum, value) => sum.plus(value), zero()).div(values.length);
    if (mean.lte(0)) return null;
    const variance = values
      .reduce((sum, value) => sum.plus(value.minus(mean).pow(2)), zero())
      .div(values.length);
    return variance.sqrt().div(mean);
  }

  private latestSync(accounts: Array<{ connection: { lastSyncedAt: Date | null } }>) {
    return accounts.reduce<Date | null>(
      (latest, account) =>
        !latest || (account.connection.lastSyncedAt && account.connection.lastSyncedAt > latest)
          ? account.connection.lastSyncedAt
          : latest,
      null,
    );
  }
}
