import { request } from './client';

export function getCurrentFinancialHealth() {
  return request('/financial-health/current');
}
export function getFinancialHealthHistory() {
  return request('/financial-health/history');
}
