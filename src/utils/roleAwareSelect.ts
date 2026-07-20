import type { Prisma } from '@prisma/client';
import { STAFF_HIDDEN_FIELDS } from '../constants/staffHiddenFields';
import { UserRole } from '../types/enums';

// Every scalar field on Customer (mirrors schema.prisma's Customer model) —
// this is what `include: { customer: true }` used to return in full. Kept
// as an explicit list (not derived at runtime) so adding a new Customer
// field is a deliberate decision about whether staff should see it.
const ALL_CUSTOMER_FIELDS: Array<keyof Prisma.CustomerSelect> = [
  'id',
  'fullName',
  'phoneNumber',
  'whatsappNumber',
  'branchId',
  'locationLabel',
  'billingMode',
  'creditLimit',
  'discountPercent',
  'bagIssued',
  'bagIssuedAt',
  'createdAt',
  'updatedAt',
];

// Primary defense (CLAUDE.md "Architecture decision, resolved"): the
// sensitive field never enters memory for a staff-authenticated request in
// the first place, rather than being fetched and stripped afterward.
export const customerSelectForRole = (role: UserRole): Prisma.CustomerSelect => {
  const hidden: readonly string[] = role === 'staff' ? STAFF_HIDDEN_FIELDS : [];

  return Object.fromEntries(
    ALL_CUSTOMER_FIELDS.filter((field) => !hidden.includes(field)).map((field) => [field, true])
  ) as Prisma.CustomerSelect;
};
