import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PluggyAdapter } from './pluggy.adapter';

describe('PluggyAdapter', () => {
  const adapter = new PluggyAdapter();
  const fixture = (name: string) =>
    JSON.parse(readFileSync(join(__dirname, '../../../test/fixtures/pluggy', name), 'utf8'));

  it('maps provider account data without leaking provider objects', () => {
    expect(adapter.mapAccount(fixture('account.json'))).toEqual({
      providerAccountId: 'acc-fixture-1',
      name: 'Conta principal',
      kind: 'CHECKING',
      currency: 'BRL',
      currentBalance: '1250.50',
      availableBalance: '1200.50',
      creditLimit: null,
    });
  });

  it('normalizes signed transaction amounts and direction', () => {
    expect(adapter.mapTransaction(fixture('transaction.json'))).toMatchObject({
      providerTransactionId: 'tx-fixture-1',
      amount: '49.90',
      direction: 'OUTFLOW',
      description: 'IFOOD*1234',
    });
  });

  it('maps bills, investments and loans through the same boundary', () => {
    expect(adapter.mapBill(fixture('bill.json'))).toMatchObject({
      providerBillId: 'bill-fixture-1',
      totalAmount: '840.25',
      status: 'OPEN',
    });
    expect(adapter.mapInvestment(fixture('investment.json'))).toMatchObject({
      providerInvestmentId: 'investment-fixture-1',
      balance: '10000.12',
    });
    expect(adapter.mapLoan(fixture('loan.json'))).toMatchObject({
      providerLoanId: 'loan-fixture-1',
      currency: 'BRL',
      outstandingBalance: '42000.50',
      installment: '1450.75',
    });
  });

  it('rejects non-finite monetary values', () => {
    expect(() => adapter.mapAccount({ id: 'acc-1', type: 'CHECKING', balance: 'NaN' })).toThrow(
      'monetary value is invalid',
    );
  });
});
