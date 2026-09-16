import { request } from './client';

export type Connection = {
  id: string;
  institution: string | null;
  status: string;
  lastSyncedAt: string | null;
  lastErrorMessage: string | null;
};

export function listConnections() {
  return request<Connection[]>('/connections');
}
export function createPluggyToken() {
  return request<{ accessToken: string }>('/connections/pluggy/token', { method: 'POST' });
}
export function reconnectPluggyToken(connectionId: string) {
  return request<{ accessToken: string }>(`/connections/${connectionId}/reconnect-token`, {
    method: 'POST',
  });
}
export function completePluggyConnection(providerItemId: string, institution?: string | null) {
  return request<{ id: string; status: string }>('/connections/pluggy/complete', {
    method: 'POST',
    body: JSON.stringify({ providerItemId, institution }),
  });
}
