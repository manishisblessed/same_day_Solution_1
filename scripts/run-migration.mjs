/* eslint-disable */
// Forward-only migration runner for db/migrations/*.sql
//
// Applies every *.sql file in db/migrations in filename order, exactly once,
// tracking applied files (with a checksum) in the `_migrations` table. Each
// file runs inside its own transaction; on failure the deploy aborts and the
// previously-running app keeps serving on the old schema.
//
// Usage:
//   node scripts/run-migration.mjs            # apply pending migrations
//   node scripts/run-migration.mjs --deploy   # same, used by npm run migrate:deploy
//   node scripts/run-migration.mjs --dir <path>   # override migrations dir
//   node scripts/run-migration.mjs --status   # list applied/pending, apply nothing

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.join(__dirname, '..')

// Minimal .env parser: fills process.env from a KEY=VALUE file without
// overriding values already present. Handles surrounding quotes, `export `
// prefixes and CRLF line endings — robust where dotenv silently no-ops.
function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    const key = m[1]
    if (process.env[key] !== undefined && process.env[key] !== '') continue
    let value = m[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

// Load .env.local: prefer dotenv, then a manual parse as a safety net.
const ENV_FILES = [
  path.join(ROOT, '.env.local'),
  path.join(process.cwd(), '.env.local'),
]
try {
  for (const f of ENV_FILES) require('dotenv').config({ path: f })
} catch {
  // dotenv is optional; the manual parser below covers this case.
}
for (const f of ENV_FILES) loadEnvFile(f)

const args = process.argv.slice(2)
const STATUS_ONLY = args.includes('--status')
const dirFlagIdx = args.indexOf('--dir')
const MIGRATIONS_DIR =
  dirFlagIdx !== -1 && args[dirFlagIdx + 1]
    ? path.resolve(process.cwd(), args[dirFlagIdx + 1])
    : path.join(ROOT, 'db', 'migrations')

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

// Supabase / managed Postgres require TLS; local dev usually does not.
function sslFor(connectionString) {
  const s = connectionString || ''
  if (/sslmode=disable/i.test(s)) return false
  if (/@localhost|@127\.0\.0\.1|@\[::1\]/i.test(s)) return false
  return { rejectUnauthorized: false }
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return []
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort()
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         SERIAL PRIMARY KEY,
      filename   TEXT NOT NULL UNIQUE,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)
}

async function getApplied(client) {
  const { rows } = await client.query(
    'SELECT filename, checksum FROM _migrations'
  )
  const map = new Map()
  for (const r of rows) map.set(r.filename, r.checksum)
  return map
}

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL not set. Checked environment and: ' + ENV_FILES.join(', ')
    )
  }

  const files = listMigrationFiles()
  const client = new Client({
    connectionString,
    ssl: sslFor(connectionString),
  })
  await client.connect()

  try {
    await ensureMigrationsTable(client)
    const applied = await getApplied(client)

    const pending = []
    for (const filename of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8')
      const checksum = sha256(sql)
      const prev = applied.get(filename)
      if (prev === undefined) {
        pending.push({ filename, sql, checksum })
      } else if (prev !== checksum) {
        // An already-applied file was edited — abort rather than silently drift.
        throw new Error(
          `Checksum mismatch for "${filename}": it was already applied but its ` +
            `contents changed. Never edit an applied migration — add a new file instead.`
        )
      }
    }

    if (STATUS_ONLY) {
      console.log(`Migrations dir: ${MIGRATIONS_DIR}`)
      console.log(`Applied: ${applied.size}, Total files: ${files.length}, Pending: ${pending.length}`)
      for (const p of pending) console.log(`  pending → ${p.filename}`)
      return
    }

    if (pending.length === 0) {
      console.log('✅ No pending migrations. Schema is up to date.')
      return
    }

    console.log(`Applying ${pending.length} pending migration(s)...`)
    for (const { filename, sql, checksum } of pending) {
      process.stdout.write(`  → ${filename} ... `)
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query(
          'INSERT INTO _migrations (filename, checksum) VALUES ($1, $2)',
          [filename, checksum]
        )
        await client.query('COMMIT')
        console.log('done')
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        console.log('FAILED')
        throw new Error(`Migration "${filename}" failed: ${e.message}`)
      }
    }
    console.log('✅ All pending migrations applied.')
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
