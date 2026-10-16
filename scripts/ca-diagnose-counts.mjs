/* eslint-disable */
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module'
const require = createRequire(import.meta.url); const { Client } = require('pg')
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
function loadEnv(fp){ if(!fs.existsSync(fp))return; for(const l of fs.readFileSync(fp,'utf8').split(/\r?\n/)){const t=l.trim(); if(!t||t.startsWith('#'))continue; const m=t.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if(!m)continue; const k=m[1]; if(process.env[k])continue; let v=m[2].trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); process.env[k]=v}}
loadEnv(path.join(ROOT,'.env.local'))
const url=process.env.DATABASE_URL
const ssl=/sslmode=disable/i.test(url)||/@localhost|@127\.0\.0\.1/i.test(url)?false:{rejectUnauthorized:false}
const c=new Client({connectionString:url,ssl})
const one=async(s,p)=>(await c.query(s,p)).rows[0]
const all=async(s,p)=>(await c.query(s,p)).rows
async function main(){
  await c.connect()
  const {today}=await one(`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today`)
  const d=today.toISOString? today : new Date(today)
  console.log(`\nIST today = ${(await one(`SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date,'YYYY-MM-DD') t`)).t}\n`)

  console.log('ADMIN definition — razorpay success & NOT reversed, today:')
  const admin=await one(`SELECT count(*) n FROM razorpay_pos_transactions
    WHERE display_status='SUCCESS' AND reversed_at IS NULL
      AND transaction_time >= (now() AT TIME ZONE 'Asia/Kolkata')::date`)
  console.log(`  ${admin.n}\n`)

  console.log('CA reimbursements today (transaction_date = IST today):')
  const ca=await all(`SELECT status, count(*) n FROM ca_reimbursement_invoices
    WHERE transaction_date = (now() AT TIME ZONE 'Asia/Kolkata')::date GROUP BY status ORDER BY status`)
  for(const r of ca) console.log(`  status=${r.status.padEnd(8)} ${r.n}`)

  console.log('\nCA reimbursements today by source:')
  const src=await one(`SELECT
      count(*) FILTER (WHERE razorpay_pos_transaction_id IS NOT NULL) razorpay,
      count(*) FILTER (WHERE pos_transaction_id IS NOT NULL) pos,
      count(*) FILTER (WHERE razorpay_pos_transaction_id IS NULL AND pos_transaction_id IS NULL) neither
    FROM ca_reimbursement_invoices
    WHERE transaction_date=(now() AT TIME ZONE 'Asia/Kolkata')::date AND status='issued'`)
  console.log(`  from razorpay=${src.razorpay}  from pos_transactions=${src.pos}  neither=${src.neither}`)

  console.log('\nIssued reimbursements today whose razorpay txn is REVERSED (should be voided):')
  const rev=await one(`SELECT count(*) n FROM ca_reimbursement_invoices ri
    JOIN razorpay_pos_transactions t ON t.id=ri.razorpay_pos_transaction_id
    WHERE ri.transaction_date=(now() AT TIME ZONE 'Asia/Kolkata')::date AND ri.status='issued'
      AND (t.reversed_at IS NOT NULL OR UPPER(COALESCE(t.display_status,'')) <> 'SUCCESS')`)
  console.log(`  ${rev.n}`)

  console.log('\nDuplicate reimbursements today (same brand+tid+amount+date, one razorpay & one pos):')
  const dup=await all(`
    SELECT brand_id, tid, transaction_amount, transaction_date,
           count(*) FILTER (WHERE razorpay_pos_transaction_id IS NOT NULL) rz,
           count(*) FILTER (WHERE pos_transaction_id IS NOT NULL) ps
    FROM ca_reimbursement_invoices
    WHERE transaction_date=(now() AT TIME ZONE 'Asia/Kolkata')::date AND status='issued'
    GROUP BY 1,2,3,4
    HAVING count(*) FILTER (WHERE razorpay_pos_transaction_id IS NOT NULL) > 0
       AND count(*) FILTER (WHERE pos_transaction_id IS NOT NULL) > 0`)
  console.log(`  dup groups=${dup.length}  (each has both a razorpay and a pos reimbursement for the same txn)`)

  console.log('\nThe 6 pos_transactions reimbursements today (invoice_number · tid · amount):')
  const six=await all(`SELECT invoice_number, tid, transaction_amount FROM ca_reimbursement_invoices
    WHERE transaction_date=(now() AT TIME ZONE 'Asia/Kolkata')::date AND pos_transaction_id IS NOT NULL
    ORDER BY transaction_amount DESC`)
  for(const r of six) console.log(`  ${String(r.invoice_number).padEnd(16)} ${String(r.tid||'—').padEnd(12)} ₹${r.transaction_amount}`)

  await c.end()
}
main().catch(async e=>{console.error(e.message);try{await c.end()}catch{};process.exit(1)})
