import { apiRequest } from './client';

export type BillingMode = 'daily' | 'monthly_billing';

export interface Customer {
  id: string;
  fullName: string;
  phoneNumber: string;
  locationLabel: string;
  branchId: string;
  branch: { branchName: string };
  billingMode: BillingMode;
  discountEnabled: boolean;
  discountPercent: string | null; // Prisma Decimal serializes as a string over JSON
}

// Admin-only (see CLAUDE.md "Known gaps"). Branch-scoped admins always get
// only their own branch server-side regardless of what's passed here — this
// param only matters for an unscoped admin narrowing the "All Branches" view.
export const fetchCustomers = (branchId?: string) => {
  const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
  return apiRequest<{ customers: Customer[] }>(`/api/v1/customers${qs}`).then((res) => res.customers);
};

export const updateCustomerBillingMode = (id: string, billingMode: BillingMode) =>
  apiRequest<{ customer: Customer }>(`/api/v1/customers/${id}/billing-mode`, {
    method: 'PATCH',
    body: { billingMode },
  }).then((res) => res.customer);

export const updateCustomerDiscountEnabled = (id: string, discountEnabled: boolean) =>
  apiRequest<{ customer: Customer }>(`/api/v1/customers/${id}/discount-enabled`, {
    method: 'PATCH',
    body: { discountEnabled },
  }).then((res) => res.customer);

export const updateCustomerDiscountPercent = (id: string, discountPercent: number) =>
  apiRequest<{ customer: Customer }>(`/api/v1/customers/${id}/discount`, {
    method: 'PATCH',
    body: { discountPercent },
  }).then((res) => res.customer);

// Search/create results don't include the `branch` relation (unlike
// fetchCustomers above, which joins it in for the admin list screen's
// section grouping) — CLAUDE.md "Customer creation": these back the New
// Order Entry phone-lookup step instead, which already knows its own
// branch from the logged-in staff member.
export type CustomerLookup = Omit<Customer, 'branch'>;

// Staff + admin — CLAUDE.md "Customer creation — real gap". Branch-scoped
// server-side: a staff caller only ever searches their own branch.
export const searchCustomers = (phone: string) =>
  apiRequest<{ customers: CustomerLookup[] }>(`/api/v1/customers/search?phone=${encodeURIComponent(phone)}`).then(
    (res) => res.customers
  );

export interface CreateCustomerInput {
  fullName: string;
  phoneNumber: string;
  locationLabel: string;
}

// Idempotent — looked up by (phoneNumber, branchId, locationLabel) same as
// order creation's own upsert; safe to call even if the customer already
// exists for this phone+flat.
export const createCustomer = (input: CreateCustomerInput) =>
  apiRequest<{ customer: CustomerLookup }>('/api/v1/customers', { method: 'POST', body: input }).then(
    (res) => res.customer
  );
