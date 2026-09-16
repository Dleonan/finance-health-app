import { request } from './client';

export type Account = {
  id: string;
  name: string;
  kind: string;
  currency: string;
  currentBalance: string | null;
  availableBalance: string | null;
  creditLimit: string | null;
  connection: { institution: string | null; status: string };
};

export function listAccounts() {
  return request<Account[]>('/accounts');
}
