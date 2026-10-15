/**
 * ONE-TIME Pay2New (BBPS-2, partner-API flow) stuck-debit backlog reconciler.
 *
 * Drains the historical backlog of pay2new partner_wallet_ledger DEBIT rows that
 * were left un-annotated (no OrderID) because they aged past the old 72h recon
 * window. Applies the EXACT conservative policy of pay2new-reconcile-cron.ts:
 *
 *   SUCCESS (provider order status=1)      -> annotate OrderID/Ref + ReconVerified (NO money)
 *   FAILED / REFUNDED (definitive verdict) -> refund REFUND_<id> + mark debit failed  [MONEY]
 *   "No Transaction Found" (inconclusive)  -> flag ReviewRequired (NO money, held)
 *   PENDING / provider unreachable         -> leave as-is (held), retry later
 *
 * Only the 15-min FLOOR is applied (all backlog is far older). No upper age bound.
 * Idempotent: a row that already has REFUND_<id> (and no CLAWBACK_) is just marked
 * failed (fast, no provider call). Safety: refunds above --max-amount or with any
 * booked P2N commission are NEVER auto-refunded — they are bucketed for manual.
 *
 * Fast design: a direct Postgres connection pulls ALL candidates + ALL refund/
 * clawback/commission keys in a handful of queries (no per-row REST), then the
 * provider status checks run through a small concurrency pool.
 *
 * MUST run from the IP-whitelisted server (provider status checks require it).
 *
 * Usage (from app root on EC2):
 *   node scripts/pay2new-backlog-reconcile.cjs                 # DRY-RUN (default, no writes)
 *   node scripts/pay2new-backlog-reconcile.cjs --apply         # execute
 *   Flags: --limit <n>, --max-amount <n> (def 100000), --conc <n> (def 6), --spacing-ms <n> (def 60)
 */
const fs = require('fs')
const path = require('path')
const https = require('https')
const { Client } = require('pg')

function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    try {
      const p = path.join(process.cwd(), f)
      if (!fs.existsSync(p)) continue
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
        if (!m) continue
        if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
      }
    } catch {}
  }
}
loadEnv()

const ARGV = process.argv.slice(2)
const APPLY = ARGV.includes('--apply')
const argVal = (name, def) => { const i = ARGV.indexOf(name); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : def }
const LIMIT = Number(argVal('--limit', 0)) || 0
const MAX_AMOUNT = Number(argVal('--max-amount', 100000))
const CONC = Math.max(1, Number(argVal('--conc', 6)))
const SPACING_MS = Number(argVal('--spacing-ms', 60))
// Provider throttles at ~500 status calls per rolling window (then it HANGS new
// connections instead of returning 429). Stay under it: after CHUNK provider
// calls, pause COOLDOWN_MS for the window to reset.
const CHUNK = Math.max(1, Number(argVal('--chunk', 350)))
const COOLDOWN_MS = Number(argVal('--cooldown-ms', 90000))

const P2N_SECRET = process.env.PAY2NEW_SECRET
const P2N_HOST = (process.env.PAY2NEW_BASE_URL || 'https://pay2new.in').replace(/^https?:\/\//, '').replace(/\/$/, '')
if (!process.env.DATABASE_URL) { console.error('Missing DATABASE_URL'); process.exit(1) }
if (!P2N_SECRET) { console.error('Missing PAY2NEW_SECRET'); process.exit(1) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const agent = new https.Agent({ keepAlive: true, maxSockets: CONC + 2 })

function providerStatus(requestId) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ client_txn_id: requestId })
    const req = https.request(
      {
        hostname: P2N_HOST, path: '/apis/v1/transactionStatus', method: 'POST', agent,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', secret: P2N_SECRET, 'Content-Length': body.length },
        timeout: 30000,
      },
      (res) => {
        let b = ''
        res.on('data', (c) => (b += c))
        res.on('end', () => {
          let j
          try { j = JSON.parse(b) } catch { return resolve({ ok: false, status: 'UNREACHABLE', note: 'non-json' }) }
          const outerMsg = String(j.message || '')
          if (Number(j.status) === 2 && /(no\s*transaction\s*found|transaction\s*not\s*found)/i.test(outerMsg)) {
            return resolve({ ok: true, status: 'FAILED', notFound: true })
          }
          const order = j.order
          if (!order) return resolve({ ok: true, status: 'PENDING', note: outerMsg })
          const os = String(order.status || '').trim()
          const om = String(order.message || '').toLowerCase()
          let st = 'PENDING'
          if (os === '1' || /success|successful/.test(om)) st = 'SUCCESS'
          else if (/refund|revers/.test(om)) st = 'REFUNDED'
          else if (/fail|failure|reject|declin|cancel/.test(om)) st = 'FAILED'
          else if (os === '2') st = 'FAILED'
          resolve({ ok: true, status: st, order_id: order.order_id, operator_reference: order.operator_reference, msg: order.message })
        })
      }
    )
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 'UNREACHABLE', note: 'timeout' }) })
    req.on('error', (e) => resolve({ ok: false, status: 'UNREACHABLE', note: e.message }))
    req.write(body); req.end()
  })
}

const tally = {
  total: 0, already_refunded: 0, success_annotated: 0, refunded: 0, refunded_amount: 0,
  not_found_flagged: 0, pending_held: 0, unreachable: 0, over_cap: 0, commission_hold: 0, errors: 0,
}
const refundList = [], overCapList = [], commissionHoldList = []

async function main() {
  console.log(`\n=== Pay2New backlog reconcile ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ===`)
  console.log(`max-amount=₹${MAX_AMOUNT} conc=${CONC} spacing=${SPACING_MS}ms limit=${LIMIT || 'none'}\n`)

  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await db.connect()

  try {
    // 1) All unresolved candidates (one query).
    const candRes = await db.query(
      `SELECT id, partner_id, reference_id, debit, description, created_at
         FROM partner_wallet_ledger
        WHERE service_type='pay2new' AND transaction_type='DEBIT'
          AND reference_id LIKE 'SDS%'
          AND status <> 'failed'
          AND created_at < now() - interval '15 minutes'
          AND description NOT ILIKE '%OrderID:%'
          AND description NOT ILIKE '%ReconVerified%'
          AND description NOT ILIKE '%ReviewRequired%'
        ORDER BY created_at ASC ${LIMIT ? `LIMIT ${LIMIT}` : ''}`
    )
    const candidates = candRes.rows
    tally.total = candidates.length
    console.log(`Candidates: ${candidates.length}`)

    // 2) All REFUND_/CLAWBACK_ keys + commission keys (one query each).
    const refRes = await db.query(
      `SELECT reference_id FROM partner_wallet_ledger
        WHERE service_type='pay2new'
          AND (reference_id LIKE 'REFUND_SDS%' OR reference_id LIKE 'CLAWBACK_SDS%')`
    )
    const refunded = new Set(), clawed = new Set()
    for (const r of refRes.rows) {
      if (r.reference_id.startsWith('REFUND_')) refunded.add(r.reference_id.slice(7))
      else if (r.reference_id.startsWith('CLAWBACK_')) clawed.add(r.reference_id.slice(9))
    }
    const commRes = await db.query(
      `SELECT reference_id FROM partner_wallet_ledger WHERE reference_id LIKE 'P2N%SDS%'`
    )
    const commission = new Set()
    for (const r of commRes.rows) {
      const m = r.reference_id.match(/(SDS\d+)/)
      if (m) commission.add(m[1])
    }
    console.log(`Known: refunded=${refunded.size} clawback=${clawed.size} commissionKeys=${commission.size}\n`)

    // 3) Split: fast-path (already refunded) vs needs-provider.
    const needProvider = []
    for (const c of candidates) {
      const ref = c.reference_id
      if (refunded.has(ref) && !clawed.has(ref)) {
        tally.already_refunded++
        if (APPLY) await db.query(`UPDATE partner_wallet_ledger SET status='failed' WHERE id=$1`, [c.id])
      } else {
        needProvider.push(c)
      }
    }
    console.log(`Already-refunded (fast path): ${tally.already_refunded}`)
    console.log(`Need provider check: ${needProvider.length}\n`)

    // 4) Provider phase — chunked (to respect the ~500/window throttle) with a
    //    concurrency pool inside each chunk.
    let done = 0
    const writeProgress = (note = '') => {
      const line = `provider ${done}/${needProvider.length}${note ? ' ' + note : ''} | refunds=${tally.refunded} (₹${tally.refunded_amount.toFixed(0)}) success=${tally.success_annotated} notFound=${tally.not_found_flagged} pending=${tally.pending_held} unreachable=${tally.unreachable} overCap=${tally.over_cap} commHold=${tally.commission_hold}`
      try { fs.writeFileSync('/tmp/p2n-backlog-progress.txt', line + '\n') } catch {}
    }

    async function processItem(c) {
      const ref = c.reference_id
      const amount = Number(c.debit)
      try {
        const st = await providerStatus(ref)
        if (SPACING_MS) await sleep(SPACING_MS)

        if (!st.ok) { tally.unreachable++ }
        else if (st.status === 'SUCCESS') {
          tally.success_annotated++
          if (APPLY) {
            const add = ` | OrderID:${st.order_id || 'N/A'} | Ref:${st.operator_reference || 'N/A'} | ReconVerified(backlog)`
            await db.query(`UPDATE partner_wallet_ledger SET description = COALESCE(description,'') || $2 WHERE id=$1`, [c.id, add])
          }
        } else if (st.notFound) {
          tally.not_found_flagged++
          if (APPLY) await db.query(`UPDATE partner_wallet_ledger SET description = COALESCE(description,'') || ' | ReviewRequired(not_found)' WHERE id=$1`, [c.id])
        } else if (st.status !== 'FAILED' && st.status !== 'REFUNDED') {
          tally.pending_held++
        } else {
          // Definitive FAILED/REFUNDED → refund owed.
          if (!Number.isFinite(amount) || amount <= 0) { tally.errors++ }
          else if (amount > MAX_AMOUNT) { tally.over_cap++; overCapList.push({ ref, partner: c.partner_id, amount }) }
          else if (commission.has(ref)) { tally.commission_hold++; commissionHoldList.push({ ref, partner: c.partner_id, amount }) }
          else {
            const reason = st.status === 'REFUNDED' ? 'provider reversed/refunded' : 'provider: failed'
            let failed = false
            if (APPLY) {
              try {
                await db.query(
                  `SELECT refund_partner_wallet(p_partner_id => $1, p_amount => $2, p_payout_transaction_id => NULL, p_description => $3, p_reference_id => $4, p_service_type => 'pay2new')`,
                  [c.partner_id, amount, `${c.description || 'BBPS-2 CC'} — auto-refund: ${reason} (backlog recon)`, 'REFUND_' + ref]
                )
                await db.query(`UPDATE partner_wallet_ledger SET status='failed' WHERE id=$1`, [c.id])
              } catch (re) {
                if (!/duplicate/i.test(re.message || '')) { tally.errors++; console.error(`REFUND FAIL ${ref}: ${re.message}`); failed = true }
              }
            }
            if (!failed) {
              tally.refunded++
              tally.refunded_amount += amount
              refundList.push({ ref, partner: c.partner_id, amount, reason, created: c.created_at })
            }
          }
        }
      } catch (e) {
        tally.errors++
        console.error(`ERROR ${ref}: ${e.message}`)
      }
      done++
      if (done % 50 === 0) writeProgress()
    }

    // Run one chunk with a pool of CONC workers.
    async function runChunk(items) {
      let idx = 0
      const worker = async () => {
        for (;;) {
          const i = idx++
          if (i >= items.length) return
          await processItem(items[i])
        }
      }
      await Promise.all(Array.from({ length: CONC }, () => worker()))
    }

    for (let off = 0; off < needProvider.length; off += CHUNK) {
      const slice = needProvider.slice(off, off + CHUNK)
      await runChunk(slice)
      writeProgress()
      const more = off + CHUNK < needProvider.length
      if (more && COOLDOWN_MS > 0) {
        console.log(`  ...chunk done at ${done}/${needProvider.length}; cooldown ${COOLDOWN_MS}ms`)
        writeProgress(`[cooldown]`)
        await sleep(COOLDOWN_MS)
      }
    }
    writeProgress()

    console.log('\n=== SUMMARY ===')
    console.table(tally)
    console.log(`\nRefunds ${APPLY ? 'APPLIED' : 'that WOULD apply'}: ${tally.refunded} totalling ₹${tally.refunded_amount.toFixed(2)}`)
    if (overCapList.length) console.log(`Over-cap (manual): ${overCapList.length} totalling ₹${overCapList.reduce((a, x) => a + x.amount, 0).toFixed(2)}`)
    if (commissionHoldList.length) console.log(`Commission-hold (manual): ${commissionHoldList.length}`)

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const prefix = APPLY ? 'APPLIED' : 'DRYRUN'
    const out = `/tmp/pay2new-backlog-${prefix}-${stamp}.json`
    fs.writeFileSync(out, JSON.stringify({ tally, refundList, overCapList, commissionHoldList }, null, 2))
    console.log(`\nArtifact: ${out}`)
  } finally {
    await db.end()
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
