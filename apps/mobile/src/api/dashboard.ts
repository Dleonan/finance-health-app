import { request } from './client';

export type DashboardToday = {
  availableCash: string;
  totalBalance: string;
  investments: string;
  liabilities: string;
  netWorth: string;
  monthlyIncome: string;
  monthlyExpenses: string;
  creditCardExposure: string;
  upcomingCommitments: string;
  financialHealth: {
    score: number | null;
    coverage: number;
    confidence: string;
    components: Array<{ key: string; score: number | null; explanation: string }>;
  };
  dataQuality: string;
  lastSyncedAt: string | null;
  currency: string;
};

export function getDashboard() {
  return request<DashboardToday>('/dashboard/today');
}
