/**
 * AEPS Background Worker
 * Handles: Transaction reconciliation, status updates, merchant sync
 * 
 * Run with: pm2 start workers/aeps-worker.js --name aeps-worker
 */

// Load environment variables from .env.local (Next.js convention)
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

const { createClient } = require('@supabase/supabase-js');

// Configuration
const POLL_INTERVAL = 60000; // 1 minute
const RECONCILIATION_INTERVAL = 300000; // 5 minutes

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('[AEPS Worker] Missing Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('[AEPS Worker] Starting...');
console.log('[AEPS Worker] Poll interval:', POLL_INTERVAL / 1000, 'seconds');
console.log('[AEPS Worker] Reconciliation interval:', RECONCILIATION_INTERVAL / 1000, 'seconds');

/**
 * Check for pending transactions that might be stuck
 */
async function checkPendingTransactions() {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    
    const { data: pendingTxns, error } = await supabase
      .from('aeps_transactions')
      .select('id, order_id, transaction_type, created_at, user_id')
      .eq('status', 'pending')
      .lt('created_at', fiveMinutesAgo)
      .limit(50);

    if (error) {
      console.error('[AEPS Worker] Error fetching pending transactions:', error);
      return;
    }

    if (pendingTxns && pendingTxns.length > 0) {
      console.log(`[AEPS Worker] Found ${pendingTxns.length} stuck pending transactions`);
      
      for (const txn of pendingTxns) {
        // Mark as under reconciliation for manual review
        await supabase
          .from('aeps_transactions')
          .update({ 
            status: 'under_reconciliation',
            error_message: 'Transaction timed out - needs manual reconciliation'
          })
          .eq('id', txn.id);
        
        console.log(`[AEPS Worker] Marked transaction ${txn.id} for reconciliation`);
      }
    }
  } catch (err) {
    console.error('[AEPS Worker] checkPendingTransactions error:', err);
  }
}

/**
 * Reconcile transactions with Chagans API
 */
async function reconcileTransactions() {
  try {
    const { data: reconTxns, error } = await supabase
      .from('aeps_transactions')
      .select('id, order_id, transaction_type, amount, user_id, merchant_id, created_at')
      .eq('status', 'under_reconciliation')
      .limit(20);

    if (error) {
      console.error('[AEPS Worker] Error fetching reconciliation transactions:', error);
      return;
    }

    if (!reconTxns || reconTxns.length === 0) {
      return;
    }

    console.log(`[AEPS Worker] ${reconTxns.length} transactions need reconciliation`);
    
    // Check if we should use mock or real API
    const useMock = process.env.AEPS_USE_MOCK === 'true';
    
    if (useMock) {
      console.log('[AEPS Worker] Mock mode - skipping Chagans status check');
      return;
    }

    // Real API reconciliation
    const clientId = process.env.CHAGHANS_AEPS_CLIENT_ID;
    const clientSecret = process.env.CHAGHANS_AEPS_CONSUMER_SECRET;
    const authToken = process.env.CHAGHANS_AEPS_AUTH_TOKEN;
    const baseUrl = process.env.CHAGHANS_AEPS_BASE_URL || 'https://api.chagans.com/aeps';

    if (!clientId || !clientSecret || !authToken) {
      console.log('[AEPS Worker] Missing Chagans credentials - skipping reconciliation');
      return;
    }

    for (const txn of reconTxns) {
      try {
        // Call Chagans status check API
        const response = await fetch(`${baseUrl}/transactionStatus`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'client-id': clientId,
            'client-secret': clientSecret,
            'authorization': authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`,
            'apiType': 'aeps',
          },
          body: JSON.stringify({
            orderId: txn.order_id,
            merchantId: txn.merchant_id,
          }),
        });

        if (!response.ok) {
          console.error(`[AEPS Worker] Status check failed for ${txn.id}: HTTP ${response.status}`);
          continue;
        }

        const result = await response.json();
        console.log(`[AEPS Worker] Status for ${txn.order_id}:`, result.success ? result.data?.status : 'unknown');

        if (result.success && result.data) {
          const status = result.data.status;
          
          if (status === 'success' || status === 'failed') {
            // Update transaction with final status
            const updateData = {
              status: status,
              completed_at: new Date().toISOString(),
              utr: result.data.utr || null,
              error_message: status === 'failed' ? (result.message || 'Transaction failed during reconciliation') : null,
            };

            await supabase
              .from('aeps_transactions')
              .update(updateData)
              .eq('id', txn.id);

            console.log(`[AEPS Worker] Reconciled ${txn.id} -> ${status}`);

            // If successful withdrawal that was previously debited, no action needed
            // If failed withdrawal, we need to refund
            if (status === 'failed' && txn.transaction_type === 'cash_withdrawal' && txn.amount > 0) {
              await refundFailedTransaction(txn);
            }
          }
        }
      } catch (apiErr) {
        console.error(`[AEPS Worker] API error for ${txn.id}:`, apiErr.message);
      }
    }
  } catch (err) {
    console.error('[AEPS Worker] reconcileTransactions error:', err);
  }
}

/**
 * Refund failed withdrawal transaction
 */
async function refundFailedTransaction(txn) {
  try {
    // Add refund entry to wallet ledger
    const { error } = await supabase.rpc('add_ledger_entry', {
      p_retailer_id: txn.user_id,
      p_tx_type: 'REFUND',
      p_amount: txn.amount,
      p_credit: true,
      p_service_type: 'aeps',
      p_description: `Refund for failed AEPS withdrawal ${txn.order_id}`,
      p_reference_id: txn.order_id,
      p_transaction_id: txn.id,
      p_wallet_type: 'aeps',
    });

    if (error) {
      console.error(`[AEPS Worker] Refund failed for ${txn.id}:`, error);
    } else {
      console.log(`[AEPS Worker] Refunded ${txn.amount} for transaction ${txn.id}`);
      
      // Update transaction to mark as refunded
      await supabase
        .from('aeps_transactions')
        .update({ 
          wallet_debited: false,
          error_message: 'Transaction failed - wallet refunded'
        })
        .eq('id', txn.id);
    }
  } catch (err) {
    console.error(`[AEPS Worker] refundFailedTransaction error:`, err);
  }
}

/**
 * Clean up old completed transactions (optional archiving)
 */
async function cleanupOldTransactions() {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    
    // Count old transactions (for logging only - don't delete automatically)
    const { count } = await supabase
      .from('aeps_transactions')
      .select('id', { count: 'exact', head: true })
      .in('status', ['success', 'failed'])
      .lt('created_at', thirtyDaysAgo);

    if (count && count > 1000) {
      console.log(`[AEPS Worker] ${count} transactions older than 30 days could be archived`);
    }
  } catch (err) {
    console.error('[AEPS Worker] cleanupOldTransactions error:', err);
  }
}

/**
 * Log daily stats
 */
async function logDailyStats() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('aeps_transactions')
      .select('status, amount')
      .gte('created_at', today.toISOString());

    if (error) {
      console.error('[AEPS Worker] Error fetching daily stats:', error);
      return;
    }

    const stats = {
      total: data?.length || 0,
      success: data?.filter(t => t.status === 'success').length || 0,
      failed: data?.filter(t => t.status === 'failed').length || 0,
      pending: data?.filter(t => t.status === 'pending').length || 0,
      volume: data?.filter(t => t.status === 'success').reduce((sum, t) => sum + (t.amount || 0), 0) || 0,
    };

    console.log('[AEPS Worker] Today\'s Stats:', JSON.stringify(stats));
  } catch (err) {
    console.error('[AEPS Worker] logDailyStats error:', err);
  }
}

// Main polling loop
async function runWorker() {
  console.log('[AEPS Worker] Running checks...');
  
  await checkPendingTransactions();
  await logDailyStats();
}

// Reconciliation loop (runs less frequently)
async function runReconciliation() {
  console.log('[AEPS Worker] Running reconciliation...');
  
  await reconcileTransactions();
  await cleanupOldTransactions();
}

// Start polling
setInterval(runWorker, POLL_INTERVAL);
setInterval(runReconciliation, RECONCILIATION_INTERVAL);

// Run immediately on start
runWorker();
setTimeout(runReconciliation, 10000);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('[AEPS Worker] Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[AEPS Worker] Shutting down...');
  process.exit(0);
});

console.log('[AEPS Worker] Started successfully');
