import { api } from '@/lib/api';
import { EnabledServicesResponse, ServiceKey } from './types';

/**
 * THE single source of control. Admin toggles retailers.{service}_enabled in the
 * web admin; this endpoint returns the resulting map. The mobile nav is rendered
 * from this, so enabling/disabling a service in admin instantly applies here too.
 */
export function fetchEnabledServices() {
  return api.get<EnabledServicesResponse>('/api/user/enabled-services');
}

export interface ServiceDef {
  /** Route/screen id */
  id: string;
  label: string;
  /** lucide-style Ionicons name */
  icon: string;
  /** color accent */
  color: string;
  /** Which enabled-service key(s) gate this. undefined = always available. */
  requires?: ServiceKey[];
  /** empty array = visible if ANY service enabled (the Services hub) */
  anyEnabled?: boolean;
  group: 'core' | 'payments' | 'banking' | 'reports' | 'account';
}

/**
 * Master catalog — mirrors the web RetailerSidebar SERVICE_TAB_MAP so mobile and
 * web show the exact same set of features for a given retailer.
 */
export const SERVICE_CATALOG: ServiceDef[] = [
  { id: 'aeps', label: 'AEPS', icon: 'finger-print', color: '#9333EA', requires: ['aeps'], group: 'banking' },
  { id: 'aadhaar-pay', label: 'Aadhaar Pay', icon: 'card', color: '#7C3AED', requires: ['aadhaar_pay'], group: 'banking' },
  { id: 'bbps', label: 'BBPS Bills', icon: 'receipt', color: '#2563EB', requires: ['bbps'], group: 'payments' },
  { id: 'bbps-2', label: 'BBPS-2', icon: 'documents', color: '#0891B2', requires: ['bbps2'], group: 'payments' },
  { id: 'recharge', label: 'Recharge', icon: 'phone-portrait', color: '#16A34A', requires: ['recharge', 'bbps2'], group: 'payments' },
  { id: 'credit-card', label: 'Credit Card', icon: 'card', color: '#EA580C', requires: ['credit_card1'], group: 'payments' },
  { id: 'credit-card-2', label: 'Credit Card-2', icon: 'card-outline', color: '#D97706', requires: ['credit_card2'], group: 'payments' },
  { id: 'api-payment', label: 'API Payment', icon: 'flash', color: '#DB2777', requires: ['api_payment'], group: 'payments' },
  { id: 'payout', label: 'Settlement-1', icon: 'cash', color: '#059669', requires: ['settlement'], group: 'banking' },
  { id: 'settlement-2', label: 'Settlement-2', icon: 'send', color: '#0D9488', requires: ['settlement2'], group: 'banking' },
  { id: 'pos-machines', label: 'POS Machines', icon: 'hardware-chip', color: '#4F46E5', requires: ['mini_atm_pos'], group: 'banking' },
  { id: 'subscriptions', label: 'Subscriptions', icon: 'repeat', color: '#7C3AED', requires: ['mini_atm_pos'], group: 'account' },
  { id: 'mdr-schemes', label: 'MDR Schemes', icon: 'pricetags', color: '#0891B2', requires: ['mini_atm_pos'], group: 'account' },
];

/** Returns the catalog entries the retailer is allowed to see. */
export function visibleServices(services: Record<string, boolean> | null | undefined): ServiceDef[] {
  if (!services) return [];
  return SERVICE_CATALOG.filter((s) => {
    if (!s.requires || s.requires.length === 0) return true;
    return s.requires.some((k) => services[k]);
  });
}

export function isEnabled(services: Record<string, boolean> | null | undefined, key: ServiceKey): boolean {
  return !!services?.[key];
}
