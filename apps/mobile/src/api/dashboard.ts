import { request } from './client';

export type DashboardToday = {
  availableCash: string | null;
  totalBalance: string | null;
  investments: string | null;
  liabilities: string | null;
  netWorth: string | null;
  monthlyIncome: string | null;
  monthlyExpenses: string | null;
  creditCardExposure: string | null;
  upcomingCommitments: string | null;
  financialHealth: {
    score: number | null;
    coverage: number;
    confidence: string;
    components: Array<{ key: string; score: number | null; explanation: string }>;
  };
  dataQuality: string;
  dataQualityReasons: string[];
  lastSyncedAt: string | null;
  currency: string;
};

export function getDashboard() {
  return request<DashboardToday>('/dashboard/today');
}
