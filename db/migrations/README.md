# Database migrations (forward-only, auto-applied on deploy)

Every SQL file in this folder is applied automatically on each deploy, in
filename order, exactly once. This is the mechanism that guarantees a schema
change ships together with the code that needs it — preventing "code deployed
without its migration" outages.

## How it runs

- Deploy runs `npm run migrate:deploy` **before** the build/restart step.
- The runner (`scripts/run-migration.mjs --deploy`) tracks applied files in the
  `_migrations` table and only runs new, unapplied files.
- Each file runs inside a transaction. If any file fails, the deploy aborts and
  the previously-running app keeps serving on the old (still-compatible) schema.

## Rules for writing a migration

1. Add a new file here — **never edit an already-applied file** (its checksum is
   recorded; edits won't re-run and will drift from prod).
2. Name it sortable: `YYYYMMDD_NNNN_short_description.sql`
   (e.g. `20260818_0001_pos_reversal_propagation.sql`).
3. Make it **idempotent** (`IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`, etc.) so
   a re-run or partial failure is safe.
4. Prefer **additive/backward-compatible** changes so the currently-running
   (old) app keeps working after the migration lands and before the new code
   restarts.

## Requirements

- `DATABASE_URL` must be present in `.env.local` on the server (already required
  for the migration runner).

## Note on the legacy root `supabase-*.sql` files

The 100+ `supabase-*.sql` files in the repo root are historical and were applied
manually/out-of-band; their tracking is incomplete. They are intentionally **not**
managed by the deploy path. Do not rely on `--all-pending` for deploys. All new
schema work goes here, in `db/migrations/`.
