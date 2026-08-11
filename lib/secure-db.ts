/**
 * Browser-side drop-in for supabase.from() / supabase.rpc() data access.
 * Routes through /api/secure/* (service role + ownership scoping).
 * Keep using `@/lib/supabase/client` only for auth (signIn/signOut/getSession).
 */
import { apiFetch } from '@/lib/api-client'

type Filter =
  | { op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'ilike' | 'like'; column: string; value: any }
  | { op: 'in'; column: string; value: any[] }
  | { op: 'is'; column: string; value: null | boolean }

type Result = { data: any; error: { message: string; code?: string } | null; count?: number | null }

class SecureQueryBuilder implements PromiseLike<Result> {
  private table: string
  private action: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private columns: string = '*'
  private filters: Filter[] = []
  private orClauses: string[] = []
  private orderClauses: { column: string; ascending?: boolean }[] = []
  private lim?: number
  private off?: number
  private rng?: [number, number]
  private countMode: 'exact' | null = null
  private wantSingle = false
  private wantMaybeSingle = false
  private payload: any = undefined

  constructor(table: string) {
    this.table = table
  }

  select(columns: string = '*', opts?: { count?: 'exact' }): this {
    this.columns = columns
    if (opts?.count === 'exact') this.countMode = 'exact'
    return this
  }

  insert(data: any): this {
    this.action = 'insert'
    this.payload = data
    return this
  }

  update(data: any): this {
    this.action = 'update'
    this.payload = data
    return this
  }

  delete(): this {
    this.action = 'delete'
    return this
  }

  eq(column: string, value: any): this {
    this.filters.push({ op: 'eq', column, value })
    return this
  }
  neq(column: string, value: any): this {
    this.filters.push({ op: 'neq', column, value })
    return this
  }
  gt(column: string, value: any): this {
    this.filters.push({ op: 'gt', column, value })
    return this
  }
  gte(column: string, value: any): this {
    this.filters.push({ op: 'gte', column, value })
    return this
  }
  lt(column: string, value: any): this {
    this.filters.push({ op: 'lt', column, value })
    return this
  }
  lte(column: string, value: any): this {
    this.filters.push({ op: 'lte', column, value })
    return this
  }
  ilike(column: string, value: any): this {
    this.filters.push({ op: 'ilike', column, value })
    return this
  }
  like(column: string, value: any): this {
    this.filters.push({ op: 'like', column, value })
    return this
  }
  in(column: string, value: any[]): this {
    this.filters.push({ op: 'in', column, value })
    return this
  }
  is(column: string, value: null | boolean): this {
    this.filters.push({ op: 'is', column, value })
    return this
  }
  or(filters: string): this {
    this.orClauses.push(filters)
    return this
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderClauses.push({ column, ascending: opts?.ascending })
    return this
  }

  limit(n: number): this {
    this.lim = n
    return this
  }

  range(from: number, to: number): this {
    this.rng = [from, to]
    return this
  }

  single(): PromiseLike<Result> & SecureQueryBuilder {
    this.wantSingle = true
    return this
  }

  maybeSingle(): PromiseLike<Result> & SecureQueryBuilder {
    this.wantMaybeSingle = true
    return this
  }

  private async execute(): Promise<Result> {
    try {
      const res = await apiFetch('/api/secure/query', {
        method: 'POST',
        body: JSON.stringify({
          table: this.table,
          action: this.action,
          select: this.columns,
          filters: this.filters,
          or: this.orClauses.length ? this.orClauses : undefined,
          order: this.orderClauses.length ? this.orderClauses : undefined,
          limit: this.lim,
          offset: this.off,
          range: this.rng,
          count: this.countMode,
          single: this.wantSingle,
          maybeSingle: this.wantMaybeSingle,
          data: this.payload,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        return {
          data: null,
          error: { message: json.error || json.message || `HTTP ${res.status}` },
          count: null,
        }
      }
      return {
        data: json.data ?? null,
        error: json.error ?? null,
        count: json.count ?? null,
      }
    } catch (e: any) {
      return { data: null, error: { message: e?.message || 'Network error' }, count: null }
    }
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected)
  }
}

export async function secureRpc(fn: string, args: Record<string, any> = {}): Promise<Result> {
  try {
    const res = await apiFetch('/api/secure/rpc', {
      method: 'POST',
      body: JSON.stringify({ fn, args }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { data: null, error: { message: json.error || json.message || `HTTP ${res.status}` } }
    }
    return { data: json.data ?? null, error: json.error ?? null }
  } catch (e: any) {
    return { data: null, error: { message: e?.message || 'Network error' } }
  }
}

/** Drop-in data client: secureDb.from('x').select() / secureDb.rpc() */
export const secureDb = {
  from(table: string) {
    return new SecureQueryBuilder(table)
  },
  rpc: secureRpc,
}
