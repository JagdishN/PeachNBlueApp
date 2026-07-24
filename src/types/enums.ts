// These fields are plain VARCHAR + CHECK constraint columns in the live
// database (docs/database_schema_v3.sql), not native Postgres enums — see
// the note at the top of backEnd/prisma/schema.prisma. Prisma Client no
// longer generates enum types for them, so the corresponding TS unions live
// here instead, for type safety in application code only (the DB enforces
// the same value set via its CHECK constraints).

export type UserRole = 'staff' | 'admin';

export type OrderInternalStatus =
  | 'picked_up'
  | 'washing'
  | 'ironing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export type PaymentMethod = 'cash' | 'upi' | 'net_banking' | 'credit_card';

export type OrderPaymentStatus = 'pending' | 'paid' | 'partially_paid' | 'due';

export type CommunicationMessageType =
  | 'pickup_confirmation'
  | 'amount_revision'
  | 'delivery_confirmation'
  | 'payment_receipt'
  | 'monthly_statement'
  | 'payment_reminder'
  | 'invoice_reissued';
