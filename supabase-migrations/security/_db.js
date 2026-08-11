// Shared Postgres connector for security migration tooling.
// Reads DATABASE_URL from .env.local (never hardcoded). Run scripts from the repo root.
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

function readDatabaseUrl() {
  let dir = process.cwd()
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, '.env.local')
    if (fs.existsSync(p)) {
      const txt = fs.readFileSync(p, 'utf8')
      const line = txt.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
      if (line) return line.slice('DATABASE_URL='.length).trim()
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('DATABASE_URL not found in .env.local')
}

async function getClient() {
  const client = new Client({
    connectionString: readDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  return client
}

module.exports = { getClient, readDatabaseUrl }
