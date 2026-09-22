import { api } from '@/lib/api';

export function fetchSubscriptions() {
  return api.get<{
    subscription: any;
    items: any[];
    debits: any[];
    commissions: any[];
    history: any[];
  }>('/api/partner/subscriptions');
}
