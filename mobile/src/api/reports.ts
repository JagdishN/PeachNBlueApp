import { apiRequest } from './client';

export interface ReportSummary {
  ordersToday: number;
  revenueToday: number;
  outstandingDues: number;
  branchesActive: number;
}

export const fetchSummary = () => apiRequest<ReportSummary>('/api/v1/reports/summary');
