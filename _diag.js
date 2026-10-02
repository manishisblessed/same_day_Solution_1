const { Client } = require('pg')
const url = 'postgresql://postgres.ohmvvtnfdvvatgofrzta:Development%400022122025@aws-1-ap-south-1.pooler.supabase.com:5432/postgres'
;(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const cols = await c.query(`select column_name from information_schema.columns where table_name='retailers' order by ordinal_position`)
  console.log('RETAILER COLS:', cols.rows.map(x=>x.column_name).join(', '))
  const name = 'Nishant'
  // 1. find retailer
  const r = await c.query(
    `select partner_id, name, business_name, distributor_id, master_distributor_id, status, bbps_enabled, credit_card2_enabled, bbps2_enabled
     from retailers where (coalesce(business_name,'') || ' ' || coalesce(name,'')) ilike $1 limit 5`, [`%${name}%`])
  console.log('RETAILER:', JSON.stringify(r.rows, null, 2))
  if (!r.rows.length) { await c.end(); return }
  const ret = r.rows[0]

  const mcols = await c.query(`select column_name from information_schema.columns where table_name='scheme_mappings' order by ordinal_position`)
  console.log('MAPPING COLS:', mcols.rows.map(x=>x.column_name).join(', '))
  // 2. mappings for this retailer (any status)
  const m = await c.query(
    `select sm.*, s.name as scheme_name
     from scheme_mappings sm
     left join schemes s on s.id = sm.scheme_id
     where sm.partner_id = $1 or sm.entity_id = $1
     order by sm.created_at desc`, [ret.partner_id]).catch(e=>({rows:[{err:e.message}]}))
  console.log('MAPPINGS(user):', JSON.stringify(m.rows, null, 2))

  // 3. resolve_scheme_for_user
  try {
    const rs = await c.query(
      `select * from resolve_scheme_for_user($1,$2,$3,$4,$5)`,
      [ret.partner_id, 'retailer', 'bbps', ret.distributor_id, ret.master_distributor_id])
    console.log('RESOLVE:', JSON.stringify(rs.rows, null, 2))
    const schemeId = rs.rows[0] && rs.rows[0].scheme_id
    if (schemeId) {
      // 4. covering slab for 100000
      const sl = await c.query(
        `select category, min_amount, max_amount, status, retailer_charge, rt_purchase_charge, rt_purchase_charge_type
         from scheme_bbps_commissions
         where scheme_id = $1 and status='active'
         order by min_amount`, [schemeId])
      console.log('BBPS SLABS:', JSON.stringify(sl.rows, null, 2))
      const cover = sl.rows.filter(x => Number(x.min_amount) <= 100000 && Number(x.max_amount) >= 100000)
      console.log('COVERING 100000:', JSON.stringify(cover, null, 2))
      // RPC charge
      const cc = await c.query(
        `select * from calculate_bbps_charge_from_scheme($1,$2,$3)`,
        [schemeId, 100000, 'Credit Card'])
      console.log('RPC CHARGE (Credit Card):', JSON.stringify(cc.rows, null, 2))
    }
  } catch (e) { console.log('RESOLVE ERR:', e.message) }

  // function signatures
  const fns = await c.query(
    `select p.proname, pg_get_function_identity_arguments(p.oid) as args
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where p.proname in ('resolve_scheme_for_user','calculate_bbps_charge_from_scheme')
     order by p.proname`)
  console.log('FUNCTIONS:', JSON.stringify(fns.rows, null, 2))

  // mapping detail via entity_id
  const m2 = await c.query(
    `select id, scheme_id, entity_id, entity_role, service_type, status, priority, effective_from, effective_to
     from scheme_mappings where entity_id=$1 order by created_at desc`, [ret.partner_id])
  console.log('MAPPINGS(entity):', JSON.stringify(m2.rows, null, 2))

  await c.end()
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
