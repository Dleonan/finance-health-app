import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PluggyClient } from 'pluggy-sdk';

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

  async fetchAccounts(itemId: string) {
    const page = await this.getClient().fetchAccounts(itemId);
    return page.results;
  }

  fetchAllTransactions(accountId: string, dateFrom: string) {
    return this.getClient().fetchAllTransactions(accountId, { dateFrom });
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
}
