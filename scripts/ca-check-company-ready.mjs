/* eslint-disable */
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module'
const require = createRequire(import.meta.url); const { Client } = require('pg')
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
function loadEnv(fp){ if(!fs.existsSync(fp))return; for(const l of fs.readFileSync(fp,'utf8').split(/\r?\n/)){const t=l.trim(); if(!t||t.startsWith('#'))continue; const m=t.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if(!m)continue; const k=m[1]; if(process.env[k])continue; let v=m[2].trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); process.env[k]=v}}
loadEnv(path.join(ROOT,'.env.local'))
const url=process.env.DATABASE_URL
const ssl=/sslmode=disable/i.test(url)||/@localhost|@127\.0\.0\.1/i.test(url)?false:{rejectUnauthorized:false}
const c=new Client({connectionString:url,ssl})
const REQ=['legal_name','address','gstin','pan','email','bank_account_number','bank_holder_name','bank_name','bank_ifsc']
async function main(){
  await c.connect()
  const rows=(await c.query(`select b.name, cc.* from brands b left join ca_company_config cc on cc.brand_id=b.id where b.active order by b.name`)).rows
  for(const r of rows){
    const miss=REQ.filter(k=>!r[k]||String(r[k]).trim()==='')
    const sl=Array.isArray(r.service_lines)?r.service_lines:(r.service_lines?JSON.parse(r.service_lines):[])
    const slOk=sl.length>0 && sl.some(x=>x.description&&x.sac)
    if(!slOk) miss.push('service_lines')
    console.log(`${(r.name||'').padEnd(24)} ${miss.length===0?'READY ✓':'missing: '+miss.join(', ')}`)
  }
  await c.end()
}
main().catch(e=>{console.error(e);process.exit(1)})
