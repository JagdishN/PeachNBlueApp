import { apiRequest } from './client';

export interface AgingRow {
  customerId: string;
  customerName: string;
  locationLabel: string;
  outstandingBalance: number;
  daysSinceLastCharge: number | null;
}

export const fetchAgingReport = () =>
  apiRequest<{ aging: AgingRow[] }>('/api/v1/ledger/aging').then((res) => res.aging);

export const sendReminder = (customerId: string) =>
  apiRequest<{ message: string }>(`/api/v1/ledger/${customerId}/remind`, { method: 'POST' });
