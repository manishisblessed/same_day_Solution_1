const { Client } = require('pg')
const DB_URL = 'postgresql://postgres.ohmvvtnfdvvatgofrzta:Development%400022122025@aws-1-ap-south-1.pooler.supabase.com:5432/postgres'

// --- Replicate settlement code normalization (lib/mdr-scheme/scheme.service.ts) ---
function normMode(m) {
  const u = (m || '').toUpperCase()
  if (u.includes('CARD')) return 'CARD'
  if (u.includes('UPI')) return 'UPI'
  return 'UPI'
}
function normCard(ct) {
  if (!ct) return null
  const u = ct.toUpperCase()
  return ['CREDIT', 'DEBIT', 'PREPAID'].includes(u) ? u : null
}
function normBrand(b) {
  if (!b) return null
  const n = b.toUpperCase().replace(/[\s_-]+/g, '')
  const A = { MASTERCARD:'MASTERCARD',MASTER:'MASTERCARD',MC:'MASTERCARD',VISA:'VISA',AMEX:'AMEX',AMERICANEXPRESS:'AMEX',RUPAY:'RUPAY',DINERS:'DINERS',DINERSCLUB:'DINERS',MAESTRO:'MAESTRO',JCB:'JCB',DISCOVER:'DISCOVER' }
  return A[n] || n || null
}

// covered = does scheme's active rates resolve this combo via the fallback chain?
function isCovered(rates, mode, cardType, brand) {
  const bt = normBrand(brand)
  return rates.some(r => {
    if (r.mode !== mode) return false
    const rBrand = r.brand_type ? normBrand(r.brand_type) : null
    // level 1/2: same card_type + matching brand
    if (r.card_type === cardType && rBrand === bt) return true
    // level 3: same card_type, generic brand (null)
    if (r.card_type === cardType && rBrand === null) return true
    // level 4: mode only (card_type null + brand null)
    if (r.card_type === null && rBrand === null) return true
    return false
  })
}

async function main() {
  const c = new Client(DB_URL)
  await c.connect()

  // All active rates grouped by scheme
  const { rows: rateRows } = await c.query(
    `SELECT scheme_id, mode, card_type, brand_type FROM scheme_mdr_rates WHERE status='active'`)
  const ratesByScheme = {}
  for (const r of rateRows) {
    (ratesByScheme[r.scheme_id] = ratesByScheme[r.scheme_id] || []).push(r)
  }

  // Non-paused retailers with distinct card combos they've transacted (last 120 days)
  const { rows: combos } = await c.query(`
    SELECT p.retailer_id, p.payment_mode, p.card_type, p.card_brand,
           COUNT(*) n, MAX(p.transaction_time) last_seen
    FROM razorpay_pos_transactions p
    JOIN retailers r ON r.partner_id = p.retailer_id
    WHERE (p.display_status ILIKE 'SUCCESS' OR p.display_status ILIKE 'CAPTURED')
      AND COALESCE(r.t1_settlement_paused, false) = false
      AND p.transaction_time > now() - interval '120 days'
    GROUP BY p.retailer_id, p.payment_mode, p.card_type, p.card_brand
    ORDER BY p.retailer_id
  `)

  // Resolve scheme per distinct retailer (cache)
  const schemeCache = {}
  async function resolve(rid) {
    if (schemeCache[rid] !== undefined) return schemeCache[rid]
    const { rows } = await c.query(
      `SELECT scheme_id, scheme_name, scheme_type FROM resolve_scheme_for_user($1,'retailer','mdr',NULL,NULL)`, [rid]
    ).catch(() => ({ rows: [] }))
    schemeCache[rid] = rows[0] || null
    return schemeCache[rid]
  }

  const gaps = []
  const retailerSet = new Set(combos.map(x => x.retailer_id))
  for (const rid of retailerSet) await resolve(rid)

  for (const combo of combos) {
    const scheme = schemeCache[combo.retailer_id]
    const mode = normMode(combo.payment_mode)
    const cardType = normCard(combo.card_type)
    if (!scheme || !scheme.scheme_id) {
      gaps.push({ rid: combo.retailer_id, scheme: 'NONE RESOLVED', mode, cardType, brand: combo.card_brand, n: combo.n, last_seen: combo.last_seen })
      continue
    }
    const rates = ratesByScheme[scheme.scheme_id] || []
    if (!isCovered(rates, mode, cardType, combo.card_brand)) {
      gaps.push({ rid: combo.retailer_id, scheme: `${scheme.scheme_name} (${scheme.scheme_type})`, scheme_id: scheme.scheme_id, mode, cardType, brand: combo.card_brand, n: combo.n, last_seen: combo.last_seen })
    }
  }

  console.log(`Audited ${retailerSet.size} non-paused retailers, ${combos.length} distinct combos.`)
  console.log(`\n=== COVERAGE GAPS (would FAIL to settle) ===`)
  if (gaps.length === 0) console.log('NONE — every non-paused retailer\u2019s card combos resolve a rate. No surprises tomorrow.')
  else console.log(JSON.stringify(gaps, null, 2))

  await c.end()
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
