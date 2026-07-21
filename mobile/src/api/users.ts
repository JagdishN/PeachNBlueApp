import { apiRequest } from './client';

export type UserRole = 'staff' | 'admin';

export interface StaffUser {
  id: string;
  fullName: string;
  phoneNumber: string;
  role: UserRole;
  branchId: string | null;
  isActive: boolean;
  createdAt: string;
}

// Admin-only (CLAUDE.md "Staff/Admin account management"). Branch-scoped
// admins always get only their own branch back server-side regardless of
// what's passed here — mirrors fetchCustomers/listBranchesHandler.
export const fetchUsers = (branchId?: string) => {
  const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
  return apiRequest<{ users: StaffUser[] }>(`/api/users${qs}`).then((res) => res.users);
};

export interface CreateUserInput {
  fullName: string;
  phoneNumber: string;
  role: UserRole;
  branchId?: string | null;
}

// No password — auth is OTP-only, this just creates the account record so
// the phone number can log in.
export const createUser = (input: CreateUserInput) =>
  apiRequest<{ user: StaffUser }>('/api/users', { method: 'POST', body: input }).then((res) => res.user);
