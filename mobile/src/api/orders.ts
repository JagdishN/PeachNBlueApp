import { apiRequest } from './client';

export type InternalStatus =
  | 'picked_up'
  | 'washing'
  | 'ironing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export interface OrderItem {
  id: string;
  garmentId: string;
  itemName: string;
  quantity: number | null;
  unitPrice: string | null;
  weightKg: string | null;
  pricePerKg: string | null;
  lineTotal: string;
}

export type PaymentMethod = 'cash' | 'upi' | 'net_banking' | 'credit_card';

export interface OrderCustomer {
  id: string;
  fullName: string;
  phoneNumber: string;
  locationLabel: string;
  branchId: string;
  // Staff can see this (unlike discountPercent/discountEnabled) — CLAUDE.md
  // "Monthly billing + discount": needed to know whether a delivery expects
  // a per-order payment (daily) or posts to the ledger instead (monthly_billing).
  billingMode: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  internalStatus: InternalStatus;
  pickupDate: string;
  deliveryDate: string | null;
  estimatedAmount: string;
  finalAmount: string;
  amountWasRevised: boolean;
  paymentStatus: string;
  paymentMethod: PaymentMethod | null;
  // Snapshot of the customer's billingMode at the moment this order was
  // created (CLAUDE.md "Monthly billing retroactivity — RESOLVED") — use
  // THIS, not customer.billingMode, to decide whether this specific order
  // needs a payment method at delivery. A customer's billing mode can
  // change after an order exists; this field intentionally doesn't.
  billingMode: string;
  staffId: string | null;
  customer: OrderCustomer;
  orderItems: OrderItem[];
}

export interface CreateOrderInput {
  customerName: string;
  customerPhoneNumber: string;
  locationLabel: string;
  branchId: string;
  pickupDate: string;
  items: { garmentId: string; quantity?: number; weightKg?: number; chosenPrice?: number }[];
}

export const createOrder = (input: CreateOrderInput) =>
  apiRequest<{ order: Order }>('/api/v1/orders', { method: 'POST', body: input }).then((res) => res.order);

export const listOrders = (params?: { date?: string; branchId?: string }) => {
  const query = new URLSearchParams();
  if (params?.date) query.set('date', params.date);
  if (params?.branchId) query.set('branchId', params.branchId);
  const qs = query.toString();

  return apiRequest<{ orders: Order[] }>(`/api/v1/orders${qs ? `?${qs}` : ''}`).then((res) => res.orders);
};

export const getOrder = (id: string) => apiRequest<{ order: Order }>(`/api/v1/orders/${id}`).then((res) => res.order);

export const updateOrderStatus = (id: string, status: InternalStatus) =>
  apiRequest<{ order: Order }>(`/api/v1/orders/${id}/status`, { method: 'PATCH', body: { status } }).then(
    (res) => res.order
  );

// CLAUDE.md "Payment marking — real gap" — bundled into the same delivery
// action as updateOrderStatus(id, 'delivered'), not a separate screen.
export const recordOrderPayment = (id: string, paymentMethod: PaymentMethod) =>
  apiRequest<{ order: Order }>(`/api/v1/orders/${id}/payment`, {
    method: 'PATCH',
    body: { paymentMethod },
  }).then((res) => res.order);

export const reviseOrderAmount = (id: string, newAmount: number, reason: string) =>
  apiRequest<{ order: Order }>(`/api/v1/orders/${id}/amount`, {
    method: 'PATCH',
    body: { newAmount, reason },
  }).then((res) => res.order);

// Admin-only — CLAUDE.md "Staff-scoped order visibility" edge case,
// resolved via a general (re)assignment control rather than a special
// creation-time flow.
export const assignOrderStaff = (id: string, staffId: string) =>
  apiRequest<{ order: Order }>(`/api/v1/orders/${id}/assign`, {
    method: 'PATCH',
    body: { staffId },
  }).then((res) => res.order);
