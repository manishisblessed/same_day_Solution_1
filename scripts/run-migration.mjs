#!/usr/bin/env node
/**
 * Run SQL migration files against Supabase Postgres directly.
 *
 * Usage:
 *   npm run migrate -- <file.sql>              # run one file
 *   npm run migrate -- <file1.sql> <file2.sql>  # run multiple files
 *   npm run migrate -- --all-pending            # run all unapplied *.sql in project root
 *
 * Requires DATABASE_URL in .env.local
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
import { resolve, basename } from 'path'
import pg from 'pg'

const { Client } = pg

// ── Load .env.local manually (no extra deps) ──
function loadEnv() {
  const envPath = resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const lines = readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnv()

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found in .env.local')
  process.exit(1)
}

// ── Migration tracking table ──
const TRACKING_DDL = `
CREATE TABLE IF NOT EXISTS _migrations (
  id         SERIAL PRIMARY KEY,
  filename   TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checksum   TEXT
);`

async function getApplied(client) {
  const { rows } = await client.query('SELECT filename FROM _migrations ORDER BY id')
  return new Set(rows.map((r) => r.filename))
}

function simpleChecksum(sql) {
  let hash = 0
  for (let i = 0; i < sql.length; i++) {
    hash = ((hash << 5) - hash + sql.charCodeAt(i)) | 0
  }
  return hash.toString(16)
}

async function runFile(client, filePath) {
  const name = basename(filePath)
  const sql = readFileSync(filePath, 'utf8')
  const checksum = simpleChecksum(sql)

  console.log(`\n⏳ Running: ${name}`)
  const start = Date.now()

  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query(
      'INSERT INTO _migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING',
      [name, checksum]
    )
    await client.query('COMMIT')
    console.log(`✅ ${name} — ${Date.now() - start}ms`)
    return true
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(`❌ ${name} FAILED:`, err.message)
    return false
  }
}

async function main() {
  const args = process.argv.slice(2)

  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await client.connect()
  console.log('🔗 Connected to Supabase Postgres')

  await client.query(TRACKING_DDL)
  const applied = await getApplied(client)

  let files = []

  if (args.includes('--all-pending')) {
    const root = process.cwd()
    files = readdirSync(root)
      .filter((f) => f.startsWith('supabase-') && f.endsWith('.sql'))
      .filter((f) => !applied.has(f))
      .sort()
      .map((f) => resolve(root, f))

    if (files.length === 0) {
      console.log('✅ No pending migrations')
      await client.end()
      return
    }
    console.log(`📋 ${files.length} pending migration(s)`)
  } else if (args.length === 0) {
    console.log('Usage:')
    console.log('  npm run migrate -- <file.sql>         Run specific migration')
    console.log('  npm run migrate -- --all-pending       Run all unapplied supabase-*.sql files')
    await client.end()
    return
  } else {
    files = args.map((f) => resolve(process.cwd(), f))
    for (const f of files) {
      if (!existsSync(f)) {
        console.error(`❌ File not found: ${f}`)
        await client.end()
        process.exit(1)
      }
    }
  }

  let passed = 0
  let failed = 0
  for (const f of files) {
    const ok = await runFile(client, f)
    if (ok) passed++
    else failed++
  }

  await client.end()
  console.log(`\n📊 Done: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
