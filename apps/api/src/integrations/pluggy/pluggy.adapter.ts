import Decimal from 'decimal.js';

export type ProviderRecord = Record<string, unknown>;

export type NormalizedAccount = {
  providerAccountId: string;
  name: string;
  kind: 'CHECKING' | 'SAVINGS' | 'CREDIT_CARD' | 'INVESTMENT' | 'LOAN' | 'OTHER';
  currency: string;
  currentBalance: string | null;
  availableBalance: string | null;
  creditLimit: string | null;
};

export type NormalizedTransaction = {
  providerTransactionId: string;
  postedAt: Date;
  description: string;
  merchantRaw: string | null;
  amount: string;
  direction: 'INFLOW' | 'OUTFLOW';
  providerCategoryId: string | null;
  status: string | null;
  providerBillId: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  isTransfer: boolean;
};

export type NormalizedBill = {
  providerBillId: string;
  dueDate: Date;
  closingDate: Date | null;
  totalAmount: string;
  minimumPayment: string | null;
  status: 'OPEN' | 'CLOSED' | 'PAID' | 'OVERDUE' | 'UNKNOWN';
};

export type NormalizedInvestment = {
  providerInvestmentId: string;
  type: string;
  name: string;
  balance: string;
  currency: string;
};

export type NormalizedLoan = {
  providerLoanId: string;
  name: string | null;
  currency: string;
  principal: string | null;
  outstandingBalance: string | null;
  installment: string | null;
  interestRate: string | null;
  nextDueDate: Date | null;
  remainingInstallments: number | null;
};

export class ProviderDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderDataError';
  }
}

export class PluggyAdapter {
  mapAccount(raw: unknown): NormalizedAccount {
    const record = this.record(raw);
    const type = this.string(record.type)?.toUpperCase() ?? '';
    const kind =
      type.includes('CREDIT') || type.includes('CARD')
        ? 'CREDIT_CARD'
        : type.includes('SAVING')
          ? 'SAVINGS'
          : type.includes('INVEST')
            ? 'INVESTMENT'
            : type.includes('LOAN')
              ? 'LOAN'
              : type.includes('CHECK') || type.includes('CURRENT')
                ? 'CHECKING'
                : 'OTHER';

    return {
      providerAccountId: this.requiredString(record.id, 'account id'),
      name: this.string(record.name) ?? 'Conta sem nome',
      kind,
      currency: this.string(record.currencyCode) ?? this.string(record.currency) ?? 'BRL',
      currentBalance: this.decimal(record.balance),
      availableBalance: this.decimal(record.availableBalance),
      creditLimit: this.decimal(
        record.creditLimit ?? this.nested(record.creditData, 'creditLimit'),
      ),
    };
  }

  mapTransaction(raw: unknown): NormalizedTransaction {
    const record = this.record(raw);
    const rawAmount = this.decimal(record.amount);
    if (rawAmount === null) throw new ProviderDataError('Transaction amount is missing');

    const amount = new Decimal(rawAmount);
    const providerType = (
      this.string(record.type) ??
      this.string(record.transactionType) ??
      ''
    ).toUpperCase();
    const direction =
      providerType.includes('CREDIT') || (amount.isNegative() === false && providerType === '')
        ? 'INFLOW'
        : 'OUTFLOW';
    const description =
      this.string(record.description) ?? this.string(record.title) ?? 'Transação sem descrição';
    const merchant = record.merchant;

    return {
      providerTransactionId: this.requiredString(record.id, 'transaction id'),
      postedAt: this.date(record.date ?? record.postedAt ?? record.createdAt, 'transaction date'),
      description,
      merchantRaw:
        typeof merchant === 'string'
          ? merchant
          : merchant && typeof merchant === 'object'
            ? this.string((merchant as ProviderRecord).name)
            : null,
      amount: amount.abs().toFixed(2),
      direction,
      providerCategoryId: this.string(record.categoryId),
      status: this.string(record.status),
      providerBillId: this.string(record.billId ?? record.creditCardBillId),
      installmentNumber: this.integer(record.installmentNumber),
      installmentTotal: this.integer(record.installmentTotal),
      isTransfer: record.isTransfer === true || providerType.includes('TRANSFER'),
    };
  }

  mapBill(raw: unknown): NormalizedBill {
    const record = this.record(raw);
    const status = (this.string(record.status) ?? '').toUpperCase();
    return {
      providerBillId: this.requiredString(record.id, 'bill id'),
      dueDate: this.date(record.dueDate, 'bill due date'),
      closingDate:
        record.closeDate || record.closingDate
          ? this.date(record.closeDate ?? record.closingDate, 'bill closing date')
          : null,
      totalAmount: this.decimal(record.totalAmount ?? record.amount) ?? '0.00',
      minimumPayment: this.decimal(record.minimumPayment ?? record.minPayment),
      status:
        status === 'OPEN' || status === 'CLOSED' || status === 'PAID' || status === 'OVERDUE'
          ? status
          : 'UNKNOWN',
    };
  }

  mapInvestment(raw: unknown): NormalizedInvestment {
    const record = this.record(raw);
    return {
      providerInvestmentId: this.requiredString(record.id, 'investment id'),
      type: this.string(record.type) ?? 'OTHER',
      name: this.string(record.name) ?? 'Investimento sem nome',
      balance: this.decimal(record.balance ?? record.amount) ?? '0.00',
      currency: this.string(record.currencyCode) ?? this.string(record.currency) ?? 'BRL',
    };
  }

  mapLoan(raw: unknown): NormalizedLoan {
    const record = this.record(raw);
    return {
      providerLoanId: this.requiredString(record.id, 'loan id'),
      name: this.string(record.name),
      currency: this.string(record.currencyCode) ?? this.string(record.currency) ?? 'BRL',
      principal: this.decimal(record.principal ?? record.originalAmount),
      outstandingBalance: this.decimal(
        record.outstandingBalance ?? record.outstanding ?? record.balance,
      ),
      installment: this.decimal(record.installment ?? record.installmentAmount),
      interestRate: this.decimal(record.interestRate),
      nextDueDate: record.nextDueDate ? this.date(record.nextDueDate, 'loan due date') : null,
      remainingInstallments: this.integer(record.remainingInstallments),
    };
  }

  private record(value: unknown): ProviderRecord {
    if (!value || typeof value !== 'object')
      throw new ProviderDataError('Provider object is invalid');
    return value as ProviderRecord;
  }

  private nested(value: unknown, key: string) {
    return value && typeof value === 'object' ? (value as ProviderRecord)[key] : undefined;
  }

  private string(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private requiredString(value: unknown, label: string) {
    const result = this.string(value);
    if (!result) throw new ProviderDataError(`Provider ${label} is missing`);
    return result;
  }

  private decimal(value: unknown) {
    if (value === null || value === undefined || value === '') return null;
    try {
      const result = new Decimal(String(value));
      if (!result.isFinite()) throw new Error('not finite');
      return result.toFixed(2);
    } catch {
      throw new ProviderDataError('Provider monetary value is invalid');
    }
  }

  private integer(value: unknown) {
    if (value === null || value === undefined || value === '') return null;
    const result = Number(value);
    return Number.isInteger(result) && result >= 0 ? result : null;
  }

  private date(value: unknown, label: string) {
    const date = new Date(String(value));
    if (!value || Number.isNaN(date.getTime()))
      throw new ProviderDataError(`Provider ${label} is invalid`);
    return date;
  }
}
