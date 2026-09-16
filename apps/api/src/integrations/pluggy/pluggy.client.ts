import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PluggyClient } from 'pluggy-sdk';

export class PluggyItemOwnershipError extends Error {
  constructor() {
    super('Provider item ownership could not be verified');
    this.name = 'PluggyItemOwnershipError';
  }
}

export class PluggyProviderUnavailableError extends Error {
  readonly statusCode?: number;

  constructor(statusCode?: number) {
    super('Provider item could not be fetched');
    this.name = 'PluggyProviderUnavailableError';
    this.statusCode = statusCode;
  }
}

@Injectable()
export class PluggyClientService {
  private client?: PluggyClient;

  constructor(private readonly config: ConfigService) {}

  async createConnectToken(itemId: string | undefined, clientUserId: string) {
    const response = await this.getClient().createConnectToken(itemId, { clientUserId });
    return { accessToken: response.accessToken };
  }

  fetchItem(itemId: string) {
    return this.getClient().fetchItem(itemId);
  }

  async verifyItemOwnership(itemId: string, clientUserId: string) {
    let item: unknown;
    try {
      item = await this.getClient().fetchItem(itemId);
    } catch (error) {
      throw new PluggyProviderUnavailableError(this.providerStatus(error));
    }
    const record = this.record(item);
    const ownerId =
      this.string(record.clientUserId) ??
      this.string(record.userId) ??
      this.nestedString(record.user, 'id');
    if (!ownerId || ownerId !== clientUserId) throw new PluggyItemOwnershipError();
    return { institution: this.readInstitution(record) };
  }

  async fetchAccounts(itemId: string) {
    const page = await this.getClient().fetchAccounts(itemId);
    return page.results;
  }

  fetchAllTransactions(accountId: string, dateFrom: string) {
    return this.getClient().fetchAllTransactions(accountId, { dateFrom });
  }

  async fetchTransactionsByIds(accountId: string, transactionIds: string[]) {
    const results = [];
    for (let index = 0; index < transactionIds.length; index += 500) {
      const page = await this.getClient().fetchTransactionsCursor(accountId, {
        ids: transactionIds.slice(index, index + 500),
      });
      results.push(...page.results);
    }
    return results;
  }

  async fetchBills(accountId: string) {
    const page = await this.getClient().fetchCreditCardBills(accountId);
    return page.results;
  }

  async fetchInvestments(itemId: string) {
    const page = await this.getClient().fetchInvestments(itemId);
    return page.results;
  }

  async fetchLoans(itemId: string) {
    const page = await this.getClient().fetchLoans(itemId);
    return page.results;
  }

  private getClient() {
    if (this.client) return this.client;
    const clientId = this.config.get<string>('PLUGGY_CLIENT_ID');
    const clientSecret = this.config.get<string>('PLUGGY_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new Error('Pluggy integration is not configured');
    }
    this.client = new PluggyClient({ clientId, clientSecret });
    return this.client;
  }

  private record(value: unknown) {
    if (!value || typeof value !== 'object') throw new PluggyItemOwnershipError();
    return value as Record<string, unknown>;
  }

  private string(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private nestedString(value: unknown, key: string) {
    return value && typeof value === 'object'
      ? this.string((value as Record<string, unknown>)[key])
      : null;
  }

  private readInstitution(item: Record<string, unknown>) {
    const connector = item.connector;
    if (connector && typeof connector === 'object') {
      return this.string((connector as Record<string, unknown>).name);
    }
    return this.string(item.institution);
  }

  private providerStatus(error: unknown) {
    if (!error || typeof error !== 'object') return undefined;
    const record = error as Record<string, unknown>;
    const response =
      record.response && typeof record.response === 'object'
        ? (record.response as Record<string, unknown>)
        : undefined;
    const status = record.statusCode ?? record.status ?? response?.status;
    if (typeof status === 'number' && Number.isInteger(status)) return status;
    if (typeof status === 'string' && /^\d+$/.test(status)) return Number(status);
    return undefined;
  }
}
