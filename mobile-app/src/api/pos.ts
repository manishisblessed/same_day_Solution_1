import { api } from '@/lib/api';

export interface PosMachine {
  id: string;
  device_serial?: string;
  machine_type?: string;
  status?: string;
  tid?: string;
  [k: string]: any;
}

export function fetchMyMachines(params?: { page?: number; limit?: number; status?: string; search?: string }) {
  return api.get<{ success: boolean; data: PosMachine[]; userRole: string; pagination: any }>(
    '/api/pos-machines/my-machines',
    { page: params?.page ?? 1, limit: params?.limit ?? 25, status: params?.status, search: params?.search }
  );
}
