/**
 * AEPS Background Worker
 * Handles: Transaction reconciliation, status updates, merchant sync
 * 
 * Run with: pm2 start workers/aeps-worker.js --name aeps-worker
 */

// Load environment variables
require('dotenv').config();

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
 * Reconcile transactions with provider (placeholder - implement when API available)
 */
async function reconcileTransactions() {
  try {
    const { data: reconTxns, error } = await supabase
      .from('aeps_transactions')
      .select('id, order_id, transaction_type, amount, user_id')
      .eq('status', 'under_reconciliation')
      .limit(20);

    if (error) {
      console.error('[AEPS Worker] Error fetching reconciliation transactions:', error);
      return;
    }

    if (reconTxns && reconTxns.length > 0) {
      console.log(`[AEPS Worker] ${reconTxns.length} transactions need reconciliation`);
      
      // TODO: Call Chagans API to check transaction status
      // For now, just log them
      for (const txn of reconTxns) {
        console.log(`[AEPS Worker] Needs reconciliation: ${txn.id} | Order: ${txn.order_id} | Type: ${txn.transaction_type}`);
      }
    }
  } catch (err) {
    console.error('[AEPS Worker] reconcileTransactions error:', err);
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
