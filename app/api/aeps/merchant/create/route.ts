import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUserWithFallback } from '@/lib/auth-server';
import { getAEPSClient } from '@/services/aeps';
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Create AEPS merchant (with KYC)
 * POST /api/aeps/merchant/create
 */
export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: 'Database configuration missing' },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { user, method } = await getCurrentUserWithFallback(request);
    console.log('[AEPS Merchant Create] Auth:', method, '|', user?.email || 'none');

    if (!user || !user.partner_id) {
      return NextResponse.json(
        { error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      );
    }

    // Only retailers, distributors, and master distributors can create merchants
    if (!['retailer', 'distributor', 'master_distributor'].includes(user.role)) {
      return NextResponse.json(
        { error: 'Forbidden: Invalid user role' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      mobile,
      name,
      gender,
      pan,
      email,
      address,
      aadhaar,
      dateOfBirth,
      latitude,
      longitude,
      bankAccountNo,
      bankIfsc,
    } = body;

    // Validation
    if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {
      return NextResponse.json({ error: 'Valid 10-digit mobile number required' }, { status: 400 });
    }

    if (!name || name.trim().length < 3) {
      return NextResponse.json({ error: 'Full name required (min 3 characters)' }, { status: 400 });
    }

    if (!gender || !['M', 'F'].includes(gender)) {
      return NextResponse.json({ error: 'Gender must be M or F' }, { status: 400 });
    }

    if (!pan || !/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) {
      return NextResponse.json({ error: 'Valid PAN required (e.g., ABCDE1234F)' }, { status: 400 });
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }

    const cleanAadhaar = aadhaar?.replace(/\s/g, '');
    if (!cleanAadhaar || !/^\d{12}$/.test(cleanAadhaar)) {
      return NextResponse.json({ error: 'Valid 12-digit Aadhaar required' }, { status: 400 });
    }

    if (!dateOfBirth) {
      return NextResponse.json({ error: 'Date of birth required' }, { status: 400 });
    }

    if (!address?.full || !address?.city || !address?.pincode) {
      return NextResponse.json({ error: 'Complete address required (full, city, pincode)' }, { status: 400 });
    }

    if (!bankAccountNo || !/^\d{9,18}$/.test(bankAccountNo)) {
      return NextResponse.json({ error: 'Valid bank account number required (9-18 digits)' }, { status: 400 });
    }

    if (!bankIfsc || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankIfsc)) {
      return NextResponse.json({ error: 'Valid IFSC code required' }, { status: 400 });
    }

    // Check if merchant already exists for this user
    const { data: existingMerchant } = await supabase
      .from('aeps_merchants')
      .select('id, merchant_id, kyc_status')
      .eq('user_id', user.partner_id)
      .maybeSingle();

    if (existingMerchant?.kyc_status === 'validated') {
      return NextResponse.json(
        {
          success: true,
          message: 'Merchant already registered',
          data: {
            merchantId: existingMerchant.merchant_id,
            kycStatus: existingMerchant.kyc_status,
          }
        }
      );
    }

    // Try to create merchant via AEPS API
    const aepsClient = getAEPSClient();
    let apiResponse;

    try {
      apiResponse = await aepsClient.createMerchant({
        mobile,
        name,
        gender,
        pan,
        email,
        address,
        aadhaar: cleanAadhaar,
        dateOfBirth,
        latitude: latitude || '19.0760',
        longitude: longitude || '72.8777',
        bankAccountNo,
        bankIfsc,
      });
    } catch (apiError: any) {
      console.error('[AEPS Merchant Create] API Error:', apiError);
      
      // If API fails, create a local pending merchant
      const tempMerchantId = `TEMP_${user.partner_id}_${Date.now()}`;
      
      await supabase.from('aeps_merchants').upsert({
        user_id: user.partner_id,
        merchant_id: tempMerchantId,
        name,
        mobile,
        email,
        pan,
        aadhaar_masked: `XXXX XXXX ${cleanAadhaar.slice(-4)}`,
        kyc_status: 'pending',
        address_full: address.full,
        address_city: address.city,
        address_pincode: address.pincode,
        bank_account_masked: `*****${bankAccountNo.slice(-4)}`,
        bank_ifsc: bankIfsc,
        created_at: new Date().toISOString(),
        api_error: apiError.message,
      }, {
        onConflict: 'user_id'
      });

      return NextResponse.json({
        success: true,
        message: 'Merchant created locally (API unavailable)',
        data: {
          merchantId: tempMerchantId,
          kycStatus: 'pending',
        }
      });
    }

    // Save merchant to database
    const merchantId = apiResponse.data?.merchantId || `${user.partner_id}_${Date.now()}`;
    const kycStatus = apiResponse.data?.kycStatus || 'pending';

    await supabase.from('aeps_merchants').upsert({
      user_id: user.partner_id,
      merchant_id: merchantId,
      name,
      mobile,
      email,
      pan,
      aadhaar_masked: `XXXX XXXX ${cleanAadhaar.slice(-4)}`,
      kyc_status: kycStatus,
      bank_pipe: apiResponse.data?.bankPipe,
      address_full: address.full,
      address_city: address.city,
      address_pincode: address.pincode,
      bank_account_masked: `*****${bankAccountNo.slice(-4)}`,
      bank_ifsc: bankIfsc,
      created_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id'
    });

    // Log activity
    const ctx = getRequestContext(request);
    logActivityFromContext(ctx, user, {
      activity_type: 'aeps_merchant_create',
      activity_category: 'aeps',
      activity_description: `AEPS merchant created - KYC: ${kycStatus}`,
      reference_id: merchantId,
      metadata: { kycStatus, bankPipe: apiResponse.data?.bankPipe },
    }).catch(() => {});

    return NextResponse.json({
      success: apiResponse.success,
      message: apiResponse.message || 'Merchant created successfully',
      data: {
        merchantId,
        kycStatus,
        bankPipe: apiResponse.data?.bankPipe,
        providerResponse: apiResponse.data?.providerResponse,
      }
    });
  } catch (error: any) {
    console.error('[AEPS Merchant Create] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create merchant' },
      { status: 500 }
    );
  }
}
