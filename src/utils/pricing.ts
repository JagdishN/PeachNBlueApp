// Shared by invoiceService.ts (invoice/payment-link amount) and
// orderService.ts (ledger charge on delivery for monthly-billing customers)
// so the two never drift apart — a discount must reduce what the customer
// is actually charged everywhere, not just on the invoice PDF.
export interface DiscountableCustomer {
  discountEnabled: boolean;
  discountPercent: unknown; // Prisma Decimal | number | null
}

export const calculatePayableAmount = (finalAmount: number, customer: DiscountableCustomer): number => {
  const discountPercent = customer.discountEnabled ? Number(customer.discountPercent ?? 0) : 0;
  return Math.round(finalAmount * (1 - discountPercent / 100) * 100) / 100;
};
