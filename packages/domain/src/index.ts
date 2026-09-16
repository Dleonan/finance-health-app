export type DataQuality = 'complete' | 'partial' | 'stale' | 'estimated';

export type Money = {
  amount: string; // decimal string across API boundaries
  currency: 'BRL' | string;
};

export type PriorityAlert = {
  id: string;
  severity: 'info' | 'attention' | 'urgent';
  title: string;
  explanation: string;
  dataQuality: DataQuality;
};
