import { request } from './client';

export function listTransactions(limit = 50, cursor?: string) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return request<{
    data: Array<{
      id: string;
      description: string;
      amount: string;
      direction: string;
      postedAt: string;
      merchantNormalized: string | null;
      account: { name: string; currency: string };
    }>;
    nextCursor: string | null;
    hasMore: boolean;
  }>(`/transactions?${params.toString()}`);
}
