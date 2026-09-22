import { api } from '@/lib/api';

export function fetchSchemes(params?: { scheme_type?: string; service_scope?: string; status?: string }) {
  return api.get<{ success: boolean; data: any[] }>('/api/schemes', params);
}

export function fetchSchemeMappings(params?: { scheme_id?: string; status?: string }) {
  return api.get<{ success: boolean; data: any[] }>('/api/schemes/mappings', {
    status: params?.status ?? 'active',
    scheme_id: params?.scheme_id,
  });
}
