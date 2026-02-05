import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { initiateTransfer } from '@/services/payout/transfer'

export const runtime = 'nodejs' // Force Node.js runtime (Supabase not compatible with Edge Runtime)
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  try {
    // Initialize Supabase client at runtime (not during build)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    
    if (!supabaseUrl || !supabaseServiceKey) {
      const response = NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    // Get current admin user with fallback
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Settlement Release] Auth:', method, '|', admin?.email || 'none')
    
    if (!admin) {
      const response = NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
      return addCorsHeaders(request, response)
    }
    if (admin.role !== 'admin') {
      const response = NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
      return addCorsHeaders(request, response)
    }

    // Check permission
    const { data: hasPermission } = await supabase.rpc('check_admin_permission', {
      p_admin_id: admin.id,
      p_permission_key: 'settlement.release'
    })

    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Unauthorized: You do not have permission to release settlements' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { settlement_id, action } = body // action: 'approve' or 'reject'

    // Validation
    if (!settlement_id || !action) {
      return NextResponse.json(
        { error: 'settlement_id and action are required' },
        { status: 400 }
      )
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be "approve" or "reject"' },
        { status: 400 }
      )
    }

    // Get IP address
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown'

    // Get settlement details
    const { data: settlement, error: settlementError } = await supabase
      .from('settlements')
      .select('*')
      .eq('id', settlement_id)
      .single()

    if (settlementError || !settlement) {
      return NextResponse.json(
        { error: 'Settlement not found' },
        { status: 404 }
      )
    }

    // Check if settlement is in pending or processing state
    if (!['pending', 'processing'].includes(settlement.status)) {
      return NextResponse.json(
        { error: `Settlement is already ${settlement.status}. Cannot release.` },
        { status: 400 }
      )
    }

    if (action === 'approve') {
      // Process the payout via SparkUpTech Express Pay
      // Get sender details from admin user
      const senderName = admin.name || admin.email?.split('@')[0] || 'Admin'
      const senderEmail = admin.email || 'admin@samedaysolution.in'
      
      // Get admin mobile from database (AuthUser doesn't have mobile property)
      let senderMobile = '9311757194' // Default admin mobile
      try {
        const { data: adminData } = await supabase
          .from('admin_users')
          .select('mobile')
          .eq('email', admin.email)
          .single()
        if (adminData?.mobile) {
          senderMobile = adminData.mobile
        }
      } catch (error) {
        console.warn('[Settlement Release] Could not fetch admin mobile, using default:', error)
      }
      
      // Get beneficiary mobile from user table (retailer/distributor/master_distributor)
      let beneficiaryMobile = '0000000000' // Default fallback
      try {
        // Try to get mobile from the user's table based on their role
        if (settlement.user_role === 'retailer') {
          const { data: retailer } = await supabase
            .from('retailers')
            .select('mobile')
            .eq('partner_id', settlement.user_id)
            .single()
          if (retailer?.mobile) {
            beneficiaryMobile = retailer.mobile
          }
        } else if (settlement.user_role === 'distributor') {
          const { data: distributor } = await supabase
            .from('distributors')
            .select('mobile')
            .eq('partner_id', settlement.user_id)
            .single()
          if (distributor?.mobile) {
            beneficiaryMobile = distributor.mobile
          }
        } else if (settlement.user_role === 'master_distributor') {
          const { data: masterDistributor } = await supabase
            .from('master_distributors')
            .select('mobile')
            .eq('partner_id', settlement.user_id)
            .single()
          if (masterDistributor?.mobile) {
            beneficiaryMobile = masterDistributor.mobile
          }
        }
      } catch (error) {
        console.warn('[Settlement Release] Could not fetch user mobile, using default:', error)
      }
      
      // If still default, try to use a valid format (SparkUpTech requires 10 digits starting with 6-9)
      if (beneficiaryMobile === '0000000000') {
        beneficiaryMobile = '9999999999' // Use a valid format for API (will be validated by initiateTransfer)
      }
      
      // Use net_amount (after charge deduction) for the transfer
      const transferAmount = parseFloat(settlement.net_amount.toString())
      
      // Generate client reference ID for tracking
      const clientRefId = `SETTLE_${settlement.id}_${Date.now()}`
      
      console.log('[Settlement Release] Initiating SparkUpTech Express Pay transfer:', {
        settlement_id: settlement.id,
        amount: transferAmount,
        account_number: settlement.bank_account_number?.slice(-4).padStart(settlement.bank_account_number.length, '*'),
        ifsc: settlement.bank_ifsc,
        account_name: settlement.bank_account_name,
        sender_name: senderName,
      })
      
      // Initiate transfer with SparkUpTech Express Pay
      const transferResult = await initiateTransfer({
        accountNumber: settlement.bank_account_number,
        ifscCode: settlement.bank_ifsc,
        accountHolderName: settlement.bank_account_name,
        amount: transferAmount,
        transferMode: 'NEFT', // Default to NEFT for settlements (can be made configurable)
        bankId: undefined, // Will be resolved from bankList API
        bankName: undefined, // Will be resolved from bankList API
        beneficiaryMobile: beneficiaryMobile,
        senderName: senderName,
        senderMobile: senderMobile,
        senderEmail: senderEmail,
        remarks: `Settlement payout - ${settlement.bank_account_name} (ID: ${settlement.id})`,
        clientRefId: clientRefId,
      })

      if (transferResult.success && transferResult.transaction_id) {
        // Payout initiated successfully
        const payoutReferenceId = transferResult.transaction_id // UTR from SparkUpTech
        const payoutStatus = transferResult.status || 'processing'
        
        // Update settlement status
        const { error: updateError } = await supabase
          .from('settlements')
          .update({
            status: payoutStatus === 'success' ? 'success' : 'processing',
            processed_at: new Date().toISOString(),
            completed_at: payoutStatus === 'success' ? new Date().toISOString() : null,
            payout_reference_id: payoutReferenceId,
            updated_at: new Date().toISOString()
          })
          .eq('id', settlement_id)

        if (updateError) {
          console.error('Error updating settlement:', updateError)
          return NextResponse.json(
            { error: 'Failed to update settlement' },
            { status: 500 }
          )
        }

        // Update ledger status if exists
        if (settlement.ledger_entry_id) {
          await supabase
            .from('wallet_ledger')
            .update({ 
              status: payoutStatus === 'success' ? 'completed' : 'pending',
              reference_id: payoutReferenceId
            })
            .eq('id', settlement.ledger_entry_id)
        }

        // Log admin action
        await supabase
          .from('admin_audit_log')
          .insert({
            admin_id: admin.id,
            action_type: 'settlement_approve',
            target_user_id: settlement.user_id,
            target_user_role: settlement.user_role,
            wallet_type: 'primary',
            amount: settlement.amount,
            before_balance: 0, // Settlement already debited
            after_balance: 0,
            ip_address: ipAddress,
            user_agent: request.headers.get('user-agent') || 'unknown',
            remarks: `Settlement approved and payout initiated - Amount: ₹${settlement.amount}, Net: ₹${settlement.net_amount}`,
            metadata: {
              settlement_id: settlement_id,
              settlement_mode: settlement.settlement_mode,
              payout_reference_id: payoutReferenceId,
              payout_status: payoutStatus,
              transaction_id: payoutReferenceId,
              provider: 'SparkUpTech Express Pay'
            }
          })

        const successResponse = NextResponse.json({
          success: true,
          message: payoutStatus === 'success' 
            ? 'Settlement approved and payout processed successfully' 
            : 'Settlement approved and payout initiated',
          settlement_id: settlement_id,
          payout_reference_id: payoutReferenceId,
          payout_status: payoutStatus,
          transaction_id: payoutReferenceId
        })
        return addCorsHeaders(request, successResponse)
      } else {
        // Payout failed - CRITICAL: Refund the wallet (money was already debited)
        const failureReason = transferResult.error || 'Payout API failed'
        
        console.error('[Settlement Release] Payout failed:', {
          settlement_id: settlement.id,
          error: failureReason,
          transfer_result: transferResult
        })
        
        // FIX: Reverse the wallet debit since payout failed
        const { error: reversalError } = await supabase.rpc('add_ledger_entry', {
          p_user_id: settlement.user_id,
          p_user_role: settlement.user_role,
          p_wallet_type: 'primary',
          p_fund_category: 'settlement',
          p_service_type: 'settlement',
          p_tx_type: 'REFUND',
          p_credit: parseFloat(settlement.amount.toString()),
          p_debit: 0,
          p_reference_id: `PAYOUT_FAILED_REFUND_${settlement.id}`,
          p_status: 'completed',
          p_remarks: `Settlement payout failed - Automatic refund. Reason: ${failureReason}`
        })

        if (reversalError) {
          console.error('CRITICAL: Failed to refund wallet after payout failure:', reversalError)
          // Mark for manual review
          await supabase
            .from('settlements')
            .update({
              status: 'failed',
              failure_reason: `${failureReason} [CRITICAL: REFUND_FAILED - Manual review required]`,
              updated_at: new Date().toISOString()
            })
            .eq('id', settlement_id)
        } else {
          await supabase
            .from('settlements')
            .update({
              status: 'failed',
              failure_reason: `${failureReason} [Wallet refunded]`,
              updated_at: new Date().toISOString()
            })
            .eq('id', settlement_id)
        }

        // Log admin action
        await supabase
          .from('admin_audit_log')
          .insert({
            admin_id: admin.id,
            action_type: 'settlement_approve_failed',
            target_user_id: settlement.user_id,
            target_user_role: settlement.user_role,
            wallet_type: 'primary',
            amount: settlement.amount,
            ip_address: ipAddress,
            user_agent: request.headers.get('user-agent') || 'unknown',
            remarks: `Settlement approval failed - ${failureReason}. Wallet ${reversalError ? 'REFUND FAILED' : 'refunded'}.`,
            metadata: {
              settlement_id: settlement_id,
              error: transferResult.error,
              failure_reason: failureReason,
              wallet_refunded: !reversalError,
              provider: 'SparkUpTech Express Pay'
            }
          })

        const errorResponse = NextResponse.json(
          { 
            error: 'Payout processing failed',
            details: failureReason,
            wallet_refunded: !reversalError
          },
          { status: 500 }
        )
        return addCorsHeaders(request, errorResponse)
      }
    } else {
      // Reject settlement - reverse the debit
      const { error: reversalError } = await supabase.rpc('add_ledger_entry', {
        p_user_id: settlement.user_id,
        p_user_role: settlement.user_role,
        p_wallet_type: 'primary',
        p_fund_category: 'settlement',
        p_service_type: 'settlement',
        p_tx_type: 'REFUND',
        p_credit: settlement.amount,
        p_debit: 0,
        p_reference_id: `SETTLEMENT_REJECT_${settlement.id}`,
        p_status: 'completed',
        p_remarks: `Settlement rejected by admin - Reversal`
      })

      if (reversalError) {
        console.error('Error reversing settlement:', reversalError)
        return NextResponse.json(
          { error: 'Failed to reverse settlement' },
          { status: 500 }
        )
      }

      // Update settlement status
      await supabase
        .from('settlements')
        .update({
          status: 'reversed',
          updated_at: new Date().toISOString()
        })
        .eq('id', settlement_id)

      // Log admin action
      await supabase
        .from('admin_audit_log')
        .insert({
          admin_id: admin.id,
          action_type: 'settlement_reject',
          target_user_id: settlement.user_id,
          target_user_role: settlement.user_role,
          wallet_type: 'primary',
          amount: settlement.amount,
          before_balance: 0,
          after_balance: 0,
          ip_address: ipAddress,
          user_agent: request.headers.get('user-agent') || 'unknown',
          remarks: `Settlement rejected by admin - Amount: ₹${settlement.amount}`,
          metadata: {
            settlement_id: settlement_id
          }
        })

      const rejectResponse = NextResponse.json({
        success: true,
        message: 'Settlement rejected and reversed successfully',
        settlement_id: settlement_id
      })
      return addCorsHeaders(request, rejectResponse)
    }
  } catch (error: any) {
    console.error('Error releasing settlement:', error)
    const errorResponse = NextResponse.json(
      { error: 'Failed to release settlement', details: error.message },
      { status: 500 }
    )
    return addCorsHeaders(request, errorResponse)
  }
}

