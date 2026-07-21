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

export interface OrderCustomer {
  id: string;
  fullName: string;
  phoneNumber: string;
  locationLabel: string;
  branchId: string;
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
