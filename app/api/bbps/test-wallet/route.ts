import { NextRequest, NextResponse } from 'next/server'
import { getBBPSWalletBalance } from '@/services/bbps'

export const dynamic = 'force-dynamic'

/**
 * Test endpoint to verify SparkUp wallet balance
 * GET /api/bbps/test-wallet
 */
export async function GET(request: NextRequest) {
  try {
    console.log('📊 Testing SparkUp Wallet Balance...')
    
    const balanceResult = await getBBPSWalletBalance()
    
    if (!balanceResult.success) {
      return NextResponse.json({
        success: false,
        error: balanceResult.error,
        message: 'Failed to fetch SparkUp wallet balance. Check API credentials and connectivity.',
      }, { status: 500 })
    }
    
    const availableBalance = (balanceResult.balance || 0) - (balanceResult.lien || 0)
    
    return NextResponse.json({
      success: true,
      data: {
        balance: balanceResult.balance,
        lien: balanceResult.lien,
        availableBalance: availableBalance,
        formatted: {
          balance: `₹${(balanceResult.balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
          lien: `₹${(balanceResult.lien || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
          available: `₹${availableBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
        },
      },
      message: 'SparkUp wallet balance fetched successfully',
      canProcessPayments: availableBalance > 0,
    })
  } catch (error: any) {
    console.error('Error testing wallet balance:', error)
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to test wallet balance',
    }, { status: 500 })
  }
}

