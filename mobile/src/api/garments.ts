import { apiRequest } from './client';

// Deliberately a plain string, not a fixed union — see CLAUDE.md "Services —
// RESOLVED". Known values: wash_fold, ironing, dry_clean, specialty_care.
export type ServiceType = string;

// UI grouping only (e.g. "Women's Wear (Dry Cleaning)", "Accessories") —
// distinct from serviceType, which is the operational service bucket.
export type GarmentCategory = string;

// "per_piece" (quantity x price) or "per_kg" (weightKg x price, 5kg order
// minimum — see CLAUDE.md "Major pricing model update").
export type PricingUnit = 'per_piece' | 'per_kg';

export interface Garment {
  id: string;
  branchId: string | null;
  itemName: string;
  serviceType: ServiceType;
  category: GarmentCategory | null;
  pricingUnit: PricingUnit;
  price: string; // Prisma Decimal serializes as a string over JSON
  priceMax: string | null; // set only for range-priced items, e.g. Designer Dress
  // When true, `price` is a floor, not a fixed amount — staff enter the
  // actual price at pickup (>= price, no upper bound). Mutually exclusive
  // with priceMax in practice: priceMax has a ceiling, this doesn't.
  isStartingPrice: boolean;
  isActive: boolean;
  displayOrder: number;
}

export interface GarmentInput {
  itemName: string;
  serviceType: ServiceType;
  category?: GarmentCategory;
  pricingUnit?: PricingUnit;
  price: number;
  priceMax?: number | null;
  isStartingPrice?: boolean;
  branchId?: string;
  displayOrder?: number;
}

export const fetchGarments = () =>
  apiRequest<{ garments: Garment[] }>('/api/v1/garments').then((res) => res.garments);

export const createGarment = (input: GarmentInput) =>
  apiRequest<{ garment: Garment }>('/api/v1/garments', { method: 'POST', body: input }).then((res) => res.garment);

export const updateGarment = (id: string, input: Partial<GarmentInput>) =>
  apiRequest<{ garment: Garment }>(`/api/v1/garments/${id}`, { method: 'PATCH', body: input }).then((res) => res.garment);

export const deleteGarment = (id: string) => apiRequest<void>(`/api/v1/garments/${id}`, { method: 'DELETE' });
