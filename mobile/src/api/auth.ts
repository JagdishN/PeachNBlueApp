import { apiRequest } from './client';

export type UserRole = 'staff' | 'admin';

export interface AuthUser {
  id: string;
  role: UserRole;
  branchId: string | null;
  fullName: string;
}

export interface VerifyOtpResponse {
  token: string;
  user: AuthUser;
}

// Matches src/controllers/authController.ts on the backend.
export const requestOtp = (phoneNumber: string) =>
  apiRequest<{ message: string }>('/api/auth/request-otp', { method: 'POST', body: { phoneNumber } });

export const verifyOtp = (phoneNumber: string, otp: string) =>
  apiRequest<VerifyOtpResponse>('/api/auth/verify-otp', { method: 'POST', body: { phoneNumber, otp } });
