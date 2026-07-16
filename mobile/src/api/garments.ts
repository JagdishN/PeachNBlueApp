import { apiRequest } from './client';

export type ServiceType = 'laundry' | 'iron' | 'both';

export interface Garment {
  id: string;
  branchId: string | null;
  itemName: string;
  serviceType: ServiceType;
  price: string; // Prisma Decimal serializes as a string over JSON
  isActive: boolean;
  displayOrder: number;
}

export interface GarmentInput {
  itemName: string;
  serviceType: ServiceType;
  price: number;
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
