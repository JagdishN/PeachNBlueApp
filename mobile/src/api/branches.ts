import { apiRequest } from './client';

export type BranchType = 'apartment' | 'area';

export interface Branch {
  id: string;
  branchName: string;
  branchType: BranchType;
  phoneNumber: string;
  whatsappNumber: string | null;
  address: string;
  city: string;
  isActive: boolean;
}

export interface BranchInput {
  branchName: string;
  branchType: BranchType;
  phoneNumber: string;
  whatsappNumber?: string;
  address: string;
  city: string;
}

export const fetchBranch = (id: string) =>
  apiRequest<{ branch: Branch }>(`/api/v1/branches/${id}`).then((res) => res.branch);

export const fetchBranches = () =>
  apiRequest<{ branches: Branch[] }>('/api/v1/branches').then((res) => res.branches);

export const createBranch = (input: BranchInput) =>
  apiRequest<{ branch: Branch }>('/api/v1/branches', { method: 'POST', body: input }).then((res) => res.branch);

export const updateBranch = (id: string, input: Partial<BranchInput>) =>
  apiRequest<{ branch: Branch }>(`/api/v1/branches/${id}`, { method: 'PATCH', body: input }).then((res) => res.branch);
