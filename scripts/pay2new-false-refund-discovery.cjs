/**
 * READ-ONLY discovery of Pay2New FALSE REFUNDS (partner-API flow).
 *
 * A "false refund" = a pay2new DEBIT we REFUNDED (REFUND_<id> exists, no
 * CLAWBACK_<id>) whose payment ACTUALLY SUCCEEDED at the vendor. Those are true
 * money-out losses recoverable via clawback (see app/api/admin/pay2new/recover).
 *
 * This script ONLY reads + queries the vendor. It NEVER writes to the DB and has
 * NO apply/clawback path. It buckets every un-clawed refund by fresh vendor
 * status and reports the ₹ exposure of the SUCCESS bucket (= clawback owed to us).
 *
 *   vendor SUCCESS            -> FALSE REFUND (clawback owed)  [exposure]
 *   vendor FAILED / REFUNDED  -> refund was CORRECT (no action)
 *   vendor "no txn found"     -> inconclusive (cannot claw back)
 *   vendor PENDING / down     -> unknown (re-check later)
 *
 * MUST run from the IP-whitelisted server. Paced for the ~500/window throttle.
 *
 * Usage (app root on EC2):
 *   node scripts/pay2new-false-refund-discovery.cjs
 *   Flags: --limit <n>, --conc <n> (def 6), --chunk <n> (def 400),
 *          --cooldown-ms <n> (def 150000), --spacing-ms <n> (def 30)
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
const argVal = (name, def) => { const i = ARGV.indexOf(name); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : def }
const LIMIT = Number(argVal('--limit', 0)) || 0
const CONC = Math.max(1, Number(argVal('--conc', 6)))
const CHUNK = Math.max(1, Number(argVal('--chunk', 400)))
const COOLDOWN_MS = Number(argVal('--cooldown-ms', 150000))
const SPACING_MS = Number(argVal('--spacing-ms', 30))

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
          try { j = JSON.parse(b) } catch { return resolve({ ok: false, status: 'UNREACHABLE' }) }
          const outerMsg = String(j.message || '')
          if (Number(j.status) === 2 && /(no\s*transaction\s*found|transaction\s*not\s*found)/i.test(outerMsg)) {
            return resolve({ ok: true, status: 'FAILED', notFound: true })
          }
          const order = j.order
          if (!order) return resolve({ ok: true, status: 'PENDING' })
          const os = String(order.status || '').trim()
          const om = String(order.message || '').toLowerCase()
          let st = 'PENDING'
          if (os === '1' || /success|successful/.test(om)) st = 'SUCCESS'
          else if (/refund|revers/.test(om)) st = 'REFUNDED'
          else if (/fail|failure|reject|declin|cancel/.test(om)) st = 'FAILED'
          else if (os === '2') st = 'FAILED'
          resolve({ ok: true, status: st, order_id: order.order_id, operator_reference: order.operator_reference })
        })
      }
    )
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 'UNREACHABLE' }) })
    req.on('error', () => resolve({ ok: false, status: 'UNREACHABLE' }))
    req.write(body); req.end()
  })
}

const tally = {
  total_unclawed_refunds: 0, false_refund_success: 0, false_refund_amount: 0,
  refund_was_correct: 0, inconclusive_notfound: 0, pending_unknown: 0, unreachable: 0, errors: 0,
}
const falseRefunds = [] // {ref, partner, amount, order_id, refundedAt}

async function main() {
  console.log('\n=== Pay2New FALSE-REFUND discovery [READ-ONLY, no writes] ===')
  console.log(`conc=${CONC} chunk=${CHUNK} cooldown=${COOLDOWN_MS}ms limit=${LIMIT || 'none'}\n`)

  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await db.connect()
  try {
    // Un-clawed partner refunds joined to their original DEBIT (for amount/owner).
    const rows = (await db.query(
      `SELECT d.partner_id,
              substring(r.reference_id from 8) AS ref,
              d.debit AS amount,
              r.created_at AS refunded_at
         FROM partner_wallet_ledger r
         JOIN partner_wallet_ledger d
           ON d.partner_id = r.partner_id
          AND d.reference_id = substring(r.reference_id from 8)
          AND d.transaction_type = 'DEBIT'
          AND d.debit > 0
        WHERE r.reference_id LIKE 'REFUND_SDS%'
          AND NOT EXISTS (
                SELECT 1 FROM partner_wallet_ledger cb
                 WHERE cb.partner_id = r.partner_id
                   AND cb.reference_id = 'CLAWBACK_' || substring(r.reference_id from 8)
              )
        ORDER BY r.created_at DESC ${LIMIT ? `LIMIT ${LIMIT}` : ''}`
    )).rows
    tally.total_unclawed_refunds = rows.length
    console.log(`Un-clawed partner refunds to verify: ${rows.length}\n`)

    let done = 0
    const writeProgress = (note = '') => {
      const line = `verified ${done}/${rows.length}${note ? ' ' + note : ''} | FALSE_REFUNDS=${tally.false_refund_success} (₹${tally.false_refund_amount.toFixed(0)}) correct=${tally.refund_was_correct} notFound=${tally.inconclusive_notfound} pending=${tally.pending_unknown} unreachable=${tally.unreachable}`
      try { fs.writeFileSync('/tmp/p2n-falserefund-progress.txt', line + '\n') } catch {}
    }

    async function processItem(c) {
      try {
        const st = await providerStatus(c.ref)
        if (SPACING_MS) await sleep(SPACING_MS)
        if (!st.ok) tally.unreachable++
        else if (st.status === 'SUCCESS') {
          tally.false_refund_success++
          tally.false_refund_amount += Number(c.amount)
          falseRefunds.push({ ref: c.ref, partner: c.partner_id, amount: Number(c.amount), order_id: st.order_id || null, refundedAt: c.refunded_at })
        } else if (st.status === 'FAILED' && st.notFound) tally.inconclusive_notfound++
        else if (st.status === 'FAILED' || st.status === 'REFUNDED') tally.refund_was_correct++
        else tally.pending_unknown++
      } catch (e) { tally.errors++; console.error(`ERR ${c.ref}: ${e.message}`) }
      done++
      if (done % 50 === 0) writeProgress()
    }

    async function runChunk(items) {
      let idx = 0
      const worker = async () => { for (;;) { const i = idx++; if (i >= items.length) return; await processItem(items[i]) } }
      await Promise.all(Array.from({ length: CONC }, () => worker()))
    }

    for (let off = 0; off < rows.length; off += CHUNK) {
      await runChunk(rows.slice(off, off + CHUNK))
      writeProgress()
      if (off + CHUNK < rows.length && COOLDOWN_MS > 0) {
        console.log(`  ...chunk done at ${done}/${rows.length}; cooldown ${COOLDOWN_MS}ms`)
        writeProgress('[cooldown]')
        await sleep(COOLDOWN_MS)
      }
    }
    writeProgress()

    // Per-partner rollup of the false-refund exposure.
    const byPartner = {}
    for (const f of falseRefunds) {
      const p = f.partner
      byPartner[p] = byPartner[p] || { count: 0, amount: 0 }
      byPartner[p].count++; byPartner[p].amount += f.amount
    }

    console.log('\n=== SUMMARY (READ-ONLY) ===')
    console.table(tally)
    console.log(`\n>>> FALSE REFUNDS (clawback owed TO US): ${tally.false_refund_success} txns totalling ₹${tally.false_refund_amount.toFixed(2)}`)
    console.log('\nBy partner:')
    for (const [p, v] of Object.entries(byPartner).sort((a, b) => b[1].amount - a[1].amount)) {
      console.log(`  ${p.slice(0, 8)}: ${v.count} txns, ₹${v.amount.toFixed(2)}`)
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const out = `/tmp/pay2new-falserefund-DISCOVERY-${stamp}.json`
    fs.writeFileSync(out, JSON.stringify({ tally, byPartner, falseRefunds }, null, 2))
    console.log(`\nArtifact: ${out}`)
  } finally {
    await db.end()
  }
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
