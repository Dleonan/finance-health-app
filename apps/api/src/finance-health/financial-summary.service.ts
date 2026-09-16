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
    const [accounts, investments, loans, bills, transactions, historicalTransactions, fact] =
      await Promise.all([
        this.prisma.account.findMany({
          where: { connection: { userId } },
          include: { connection: true },
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

    const baseCurrencyAccounts = accounts.filter(
      (account) => account.currency === user.baseCurrency,
    );
    const liquidAssets = baseCurrencyAccounts
      .filter((account) => ['CHECKING', 'SAVINGS', 'OTHER'].includes(account.kind))
      .reduce(
        (sum, account) => sum.plus(account.availableBalance ?? account.currentBalance ?? zero()),
        zero(),
      );
    const totalBalance = baseCurrencyAccounts.reduce(
      (sum, account) => sum.plus(account.currentBalance ?? zero()),
      zero(),
    );
    const investedAssets = investments
      .filter((investment) => investment.currency === user.baseCurrency)
      .reduce((sum, investment) => sum.plus(investment.snapshots[0]?.balance ?? zero()), zero());
    const baseCurrencyBills = bills.filter((bill) => bill.account.currency === user.baseCurrency);
    const baseCurrencyTransactions = transactions.filter(
      (transaction) => transaction.account.currency === user.baseCurrency,
    );
    const baseCurrencyLoans = loans.filter((loan) => loan.currency === user.baseCurrency);
    const cardExposure = baseCurrencyBills.reduce(
      (sum, bill) => sum.plus(bill.totalAmount),
      zero(),
    );
    const loanLiabilities = baseCurrencyLoans.reduce(
      (sum, loan) => sum.plus(loan.outstandingBalance ?? zero()),
      zero(),
    );
    const liabilities = loanLiabilities.plus(cardExposure);
    const monthlyIncome = baseCurrencyTransactions
      .filter((transaction) => transaction.direction === 'INFLOW' && !transaction.isTransfer)
      .reduce((sum, transaction) => sum.plus(transaction.amount), zero());
    const monthlyExpenses = baseCurrencyTransactions
      .filter((transaction) => transaction.direction === 'OUTFLOW' && !transaction.isTransfer)
      .reduce((sum, transaction) => sum.plus(transaction.amount), zero());
    const upcomingCommitments = baseCurrencyBills
      .filter((bill) => bill.dueDate >= now && bill.dueDate < next30)
      .reduce((sum, bill) => sum.plus(bill.totalAmount), zero())
      .plus(
        baseCurrencyLoans
          .filter(
            (loan) => loan.nextDueDate && loan.nextDueDate >= now && loan.nextDueDate < next30,
          )
          .reduce((sum, loan) => sum.plus(loan.installment ?? zero()), zero()),
      );
    const debtService = baseCurrencyLoans.reduce(
      (sum, loan) => sum.plus(loan.installment ?? zero()),
      zero(),
    );
    const hasLiquidAssets = baseCurrencyAccounts.some(
      (account) => account.availableBalance !== null || account.currentBalance !== null,
    );
    const hasCurrentTransactions = baseCurrencyTransactions.length > 0;
    const hasDebtService = baseCurrencyLoans.some((loan) => loan.installment !== null);
    const hasUpcomingCommitments =
      baseCurrencyBills.length > 0 ||
      baseCurrencyLoans.some((loan) => loan.nextDueDate !== null && loan.installment !== null);
    const hasCardLimit = baseCurrencyAccounts.some(
      (account) => account.kind === 'CREDIT_CARD' && account.creditLimit !== null,
    );
    const monthlyHistory = this.monthlyHistory(historicalTransactions, user.timezone);
    const incomeVolatility = this.volatility(monthlyHistory.map((month) => month.income));
    const essentialExpenseVolatility = this.volatility(
      monthlyHistory.map((month) => month.expenses),
    );
    const historyMonths = monthlyHistory.length;
    const dataQuality = this.quality(
      baseCurrencyAccounts,
      baseCurrencyTransactions,
      baseCurrencyBills,
    );
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
      monthlyIncome: hasCurrentTransactions ? monthlyIncome.toFixed(2) : null,
      monthlyExpenses: hasCurrentTransactions ? monthlyExpenses.toFixed(2) : null,
      essentialMonthlyExpenses:
        fact?.value !== null && fact?.value !== undefined
          ? fact.value.toFixed(2)
          : hasCurrentTransactions
            ? monthlyExpenses.toFixed(2)
            : null,
      liquidAssets: hasLiquidAssets ? liquidAssets.toFixed(2) : null,
      monthlyDebtService: hasDebtService ? debtService.toFixed(2) : null,
      revolvingOrCardBalance: baseCurrencyBills.length ? cardExposure.toFixed(2) : null,
      totalCardLimit: hasCardLimit
        ? baseCurrencyAccounts
            .filter((account) => account.kind === 'CREDIT_CARD')
            .reduce((sum, account) => sum.plus(account.creditLimit ?? zero()), zero())
            .toFixed(2)
        : null,
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
    return {
      availableCash: liquidAssets.toFixed(2),
      totalBalance: totalBalance.toFixed(2),
      investments: investedAssets.toFixed(2),
      liabilities: liabilities.toFixed(2),
      netWorth: liquidAssets.plus(investedAssets).minus(liabilities).toFixed(2),
      monthlyIncome: monthlyIncome.toFixed(2),
      monthlyExpenses: monthlyExpenses.toFixed(2),
      creditCardExposure: cardExposure.toFixed(2),
      upcomingCommitments: upcomingCommitments.toFixed(2),
      financialHealth,
      dataQuality,
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
    accounts: Array<{ connection: { status: string } }>,
    transactions: unknown[],
    bills: unknown[],
  ) {
    if (!accounts.length) return DataQuality.UNAVAILABLE;
    if (accounts.some((account) => account.connection.status === 'STALE')) return DataQuality.STALE;
    if (!transactions.length) return DataQuality.PARTIAL;
    return bills.length ? DataQuality.COMPLETE : DataQuality.PARTIAL;
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
