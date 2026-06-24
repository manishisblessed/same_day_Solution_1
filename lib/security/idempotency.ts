// Server-only module.
import crypto from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export interface IdempotencyResult {
  /** true if this is the first time we've seen this key (caller should proceed) */
  fresh: boolean
  /** if not fresh, the previously stored response (may be null if still in progress) */
  cachedResponse: any | null
  /** previous status, if any */
  status?: 'in_progress' | 'completed' | 'failed'
  /** opaque token used to finalize this key */
  key: string
  scope: string
}

const TABLE = 'idempotency_keys'

export function hashRequest(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex')
}

/**
 * Reserve an idempotency key for a given scope. Relies on the DB unique
 * constraint (scope, idempotency_key) to win races atomically.
 *
 * FAIL-OPEN: if the idempotency_keys table doesn't exist yet (migration not
 * run) any error is swallowed and the request is treated as fresh, so this
 * never breaks production. Once the migration is applied it becomes enforcing.
 */
export async function reserveIdempotencyKey(params: {
  scope: string
  key: string | null | undefined
  userId?: string | null
  requestHash?: string
}): Promise<IdempotencyResult> {
  const { scope, userId, requestHash } = params
  const key = (params.key || '').trim()

  // No key supplied by client → cannot dedup, proceed.
  if (!key) {
    return { fresh: true, cachedResponse: null, key: '', scope }
  }

  try {
    const admin = getSupabaseAdmin()
    const { error } = await admin.from(TABLE).insert({
      scope,
      idempotency_key: key,
      user_id: userId ?? null,
      request_hash: requestHash ?? null,
      status: 'in_progress',
    })

    if (!error) {
      return { fresh: true, cachedResponse: null, key, scope }
    }

    // 23505 = unique_violation → already reserved
    if ((error as any).code === '23505') {
      const { data: existing } = await admin
        .from(TABLE)
        .select('response, status')
        .eq('scope', scope)
        .eq('idempotency_key', key)
        .maybeSingle()

      // A previously FAILED attempt is retryable: atomically re-claim the row
      // (only one concurrent caller can flip it back to in_progress).
      if (existing?.status === 'failed') {
        const { data: reclaimed } = await admin
          .from(TABLE)
          .update({
            status: 'in_progress',
            request_hash: requestHash ?? null,
            response: null,
            updated_at: new Date().toISOString(),
          })
          .eq('scope', scope)
          .eq('idempotency_key', key)
          .eq('status', 'failed')
          .select('id')
        if (reclaimed && reclaimed.length > 0) {
          return { fresh: true, cachedResponse: null, key, scope }
        }
        // Someone else re-claimed it first — treat as in-progress duplicate.
      }

      return {
        fresh: false,
        cachedResponse: existing?.response ?? null,
        status: existing?.status,
        key,
        scope,
      }
    }

    // DB error (e.g. table missing) → fail closed to prevent duplicate transactions
    console.error('[idempotency] reserve failed (BLOCKING for safety):', (error as any).message)
    return { fresh: false, cachedResponse: { error: 'Unable to process request safely. Please try again.' }, key, scope }
  } catch (e: any) {
    console.error('[idempotency] unexpected error (BLOCKING for safety):', e?.message)
    return { fresh: false, cachedResponse: { error: 'Unable to process request safely. Please try again.' }, key, scope }
  }
}

/** Persist the final response for a key so retries return the same result. */
export async function finalizeIdempotencyKey(params: {
  scope: string
  key: string
  status: 'completed' | 'failed'
  response?: any
}): Promise<void> {
  const { scope, key, status, response } = params
  if (!key) return
  try {
    await getSupabaseAdmin()
      .from(TABLE)
      .update({ status, response: response ?? null, updated_at: new Date().toISOString() })
      .eq('scope', scope)
      .eq('idempotency_key', key)
  } catch (e: any) {
    console.warn('[idempotency] finalize failed (non-fatal):', e?.message)
  }
}

/** Read an idempotency key from common header names. */
export function getIdempotencyKeyFromHeaders(headers: Headers): string | null {
  return (
    headers.get('idempotency-key') ||
    headers.get('x-idempotency-key') ||
    headers.get('x-request-id') ||
    null
  )
}
