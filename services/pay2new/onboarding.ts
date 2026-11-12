/**
 * Pay2New Customer Onboarding — PAN-Based Onboarding API
 * POST https://pay2new.in/apis/v1/onboard/customerMinKyc
 *
 * Headers: secret only (no outletId — this creates the outletId)
 * On success: returns outletId which is the merchant's Pay2New identity
 */

import { getPay2NewSecret, getPay2NewBaseUrl, getPay2NewTimeout } from './config';

// ─── Request ──────────────────────────────────────────────────────────────────
export interface Pay2NewPanOnboardRequest {
  mobile_number: string;   // 10 digits
  pan_number: string;      // 10 chars
  name: string;
  gender: 'M' | 'F' | 'O';
  aadhaar_number?: string; // plain 12 digits — one of aadhaar_number/aadhaar required
  aadhaar?: string;        // encrypted alternative; takes precedence if both provided
  email: string;
  address: string;
  city?: string;
  pincode: string;         // 6 digits
  dob: string;             // YYYY-MM-DD
  latitude: string;
  longitude: string;
  terms_agree: 'Y';
  product_code?: string;   // digits only; 291 default
  ip: string;              // IPv4
  request_id: string;      // min 8 chars — your unique ref
  state?: string;
  district?: string;
  photo?: string;
}

// ─── Response ─────────────────────────────────────────────────────────────────
export interface Pay2NewPanOnboardData {
  name?: string;
  address?: string;
  gender?: string;
  pincode?: string;
  dob?: string;
  state?: string;
  district?: string;
  photo?: string | null;
  pan_number?: string;
}

export interface Pay2NewPanOnboardResponse {
  status: 1 | 2 | 3;
  message: string;
  order_id?: string;
  request_id?: string;
  /** Pay2New merchant outletId — store this as aeps_merchants.merchant_id */
  outletId?: string;
  data?: Pay2NewPanOnboardData;
  errors?: Record<string, string>;
}

// ─── Client ───────────────────────────────────────────────────────────────────
export class Pay2NewOnboardingError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: Pay2NewPanOnboardResponse,
  ) {
    super(message);
    this.name = 'Pay2NewOnboardingError';
  }
}

/**
 * Onboard a merchant with Pay2New using PAN + Aadhaar.
 * Returns the Pay2New `outletId` which must be stored as the merchant's AePS ID.
 */
export async function onboardMerchantPAN(
  payload: Pay2NewPanOnboardRequest,
): Promise<Pay2NewPanOnboardResponse> {
  const secret = getPay2NewSecret();
  if (!secret) throw new Error('PAY2NEW_SECRET not configured');

  const url = `${getPay2NewBaseUrl()}/apis/v1/onboard/customerMinKyc`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getPay2NewTimeout());

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        secret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Pay2NewOnboardingError(
      `Pay2New onboarding HTTP ${res.status}`,
      res.status,
    );
  }

  const data: Pay2NewPanOnboardResponse = await res.json();
  return data;
}
