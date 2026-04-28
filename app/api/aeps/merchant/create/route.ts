import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUserWithFallback } from '@/lib/auth-server';
import { getAEPSClient } from '@/services/aeps';
import { getAEPSConfig } from '@/services/aeps/config';
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
    
    // Support both flat and nested address formats
    const mobile = body.mobile;
    const name = body.name;
    const gender = body.gender;
    const pan = body.pan?.toUpperCase();
    const email = body.email;
    const dateOfBirth = body.dateOfBirth || body.dob;
    const latitude = body.latitude;
    const longitude = body.longitude;
    const bankAccountNo = body.bankAccountNo || body.bankAccountNumber;
    const bankIfsc = body.bankIfsc?.toUpperCase();
    const bankName = body.bankName;
    const aadhaar = body.aadhaar || body.aadhar;
    
    // Handle address - support both nested object and flat fields
    const address = body.address && typeof body.address === 'object' 
      ? body.address 
      : {
          full: body.address || `${body.city || ''}, ${body.pincode || ''}`.trim(),
          city: body.city || '',
          pincode: body.pincode || ''
        };

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

    // Email is optional but validate if provided
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    const cleanAadhaar = aadhaar?.replace(/\s/g, '');
    if (!cleanAadhaar || !/^\d{12}$/.test(cleanAadhaar)) {
      return NextResponse.json({ error: 'Valid 12-digit Aadhaar required' }, { status: 400 });
    }

    if (!dateOfBirth) {
      return NextResponse.json({ error: 'Date of birth required' }, { status: 400 });
    }

    // Validate address fields
    const addressFull = address.full || address.address || '';
    const addressCity = address.city || '';
    const addressPincode = address.pincode || '';
    
    if (!addressCity || !addressPincode) {
      return NextResponse.json({ error: 'City and pincode are required' }, { status: 400 });
    }

    if (!/^\d{6}$/.test(addressPincode)) {
      return NextResponse.json({ error: 'Valid 6-digit pincode required' }, { status: 400 });
    }

    if (!bankAccountNo || !/^\d{9,18}$/.test(bankAccountNo)) {
      return NextResponse.json({ error: 'Valid bank account number required (9-18 digits)' }, { status: 400 });
    }

    if (!bankIfsc || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankIfsc)) {
      return NextResponse.json({ error: 'Valid IFSC code required' }, { status: 400 });
    }
    
    // Normalize address object for API call
    const normalizedAddress = {
      full: addressFull || `${addressCity}, ${addressPincode}`,
      city: addressCity,
      pincode: addressPincode
    };

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

    // In mock mode, never call Chagans (avoids IP whitelist errors on local dev egress)
    if (getAEPSConfig().useMock) {
      const mockMerchantId = `MOCK_${user.partner_id}`;
      await supabase.from('aeps_merchants').upsert(
        {
          user_id: user.partner_id,
          merchant_id: mockMerchantId,
          name,
          mobile,
          email: email || null,
          pan,
          aadhaar_masked: `XXXX XXXX ${cleanAadhaar.slice(-4)}`,
          date_of_birth: dateOfBirth,
          gender,
          kyc_status: 'validated',
          address_full: normalizedAddress.full,
          address_city: normalizedAddress.city,
          address_pincode: normalizedAddress.pincode,
          bank_account_masked: `*****${bankAccountNo.slice(-4)}`,
          bank_ifsc: bankIfsc,
          bank_name: bankName || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
      return NextResponse.json({
        success: true,
        message: 'Merchant created (mock mode — Chagans not called)',
        isMockMode: true,
        data: {
          merchantId: mockMerchantId,
          kycStatus: 'validated',
        },
      });
    }

    // Try to create merchant via AEPS API
    const aepsClient = getAEPSClient();
    let apiResponse;

    try {
      console.log('[AEPS Merchant Create] Calling Chagans API for user:', user.partner_id);
      apiResponse = await aepsClient.createMerchant({
        mobile,
        name,
        gender,
        pan,
        email: email || `${mobile}@aeps.local`,
        address: normalizedAddress,
        aadhaar: cleanAadhaar,
        dateOfBirth,
        latitude: latitude || '19.0760',
        longitude: longitude || '72.8777',
        bankAccountNo,
        bankIfsc,
      });
      console.log('[AEPS Merchant Create] Chagans API response:', JSON.stringify(apiResponse, null, 2));
    } catch (apiError: any) {
      console.error('[AEPS Merchant Create] API Error:', apiError);
      
      // If API fails, create a local pending merchant for retry
      const tempMerchantId = `PENDING_${user.partner_id}_${Date.now()}`;
      
      await supabase.from('aeps_merchants').upsert({
        user_id: user.partner_id,
        merchant_id: tempMerchantId,
        name,
        mobile,
        email: email || null,
        pan,
        aadhaar_masked: `XXXX XXXX ${cleanAadhaar.slice(-4)}`,
        date_of_birth: dateOfBirth,
        gender,
        kyc_status: 'pending',
        address_full: normalizedAddress.full,
        address_city: normalizedAddress.city,
        address_pincode: normalizedAddress.pincode,
        bank_account_masked: `*****${bankAccountNo.slice(-4)}`,
        bank_ifsc: bankIfsc,
        bank_name: bankName || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        api_error: apiError.message || 'API call failed',
        kyc_provider_response: JSON.stringify({ error: apiError.message, data: apiError.data }),
      }, {
        onConflict: 'user_id'
      });

      return NextResponse.json({
        success: true,
        message: 'Merchant registration initiated (pending verification)',
        data: {
          merchantId: tempMerchantId,
          kycStatus: 'pending',
          apiError: apiError.message,
        }
      });
    }

    // Extract merchant ID from Chagans response - handle different response formats
    const responseData = apiResponse.data as any;

    // If Chagans returned success: false, KYC was rejected — don't save a fake merchant
    if (!apiResponse.success) {
      const providerMessage = responseData?.providerResponse 
        || apiResponse.message 
        || 'KYC verification failed';
      console.log('[AEPS Merchant Create] KYC rejected by provider:', providerMessage);

      // Clean up any previous failed merchant record so user can retry
      await supabase.from('aeps_merchants')
        .delete()
        .eq('user_id', user.partner_id)
        .in('kyc_status', ['pending', 'failed']);

      return NextResponse.json({
        success: false,
        error: providerMessage,
        message: providerMessage,
        isMockMode: false,
        data: {
          kycStatus: 'failed',
          bankPipe: responseData?.bankPipe,
          providerResponse: responseData?.providerResponse,
        }
      });
    }

    let merchantId = responseData?.merchantId 
      || responseData?.merchant_id 
      || responseData?.id
      || (apiResponse as any).merchantId;
    
    if (!merchantId || merchantId.includes('TEMP_') || merchantId.includes('MOCK_')) {
      merchantId = `CHAGANS_${user.partner_id}_${Date.now()}`;
    }
    
    const kycStatus = responseData?.kycStatus 
      || responseData?.kyc_status 
      || 'validated';

    console.log('[AEPS Merchant Create] Saving merchant:', merchantId, 'with KYC status:', kycStatus);

    await supabase.from('aeps_merchants').upsert({
      user_id: user.partner_id,
      merchant_id: merchantId,
      name,
      mobile,
      email: email || null,
      pan,
      aadhaar_masked: `XXXX XXXX ${cleanAadhaar.slice(-4)}`,
      date_of_birth: dateOfBirth,
      gender,
      kyc_status: kycStatus,
      bank_pipe: responseData?.bankPipe || responseData?.route,
      route: responseData?.route,
      address_full: normalizedAddress.full,
      address_city: normalizedAddress.city,
      address_pincode: normalizedAddress.pincode,
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      bank_account_masked: `*****${bankAccountNo.slice(-4)}`,
      bank_ifsc: bankIfsc,
      bank_name: bankName || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      kyc_provider_response: JSON.stringify(responseData),
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
      success: true,
      message: apiResponse.message || 'Merchant created successfully',
      isMockMode: getAEPSConfig().useMock,
      data: {
        merchantId,
        kycStatus,
        bankPipe: responseData?.bankPipe,
        providerResponse: responseData?.providerResponse,
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
