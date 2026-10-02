-- ============================================================================
-- GST RECONCILIATION (missed-GST recovery)
-- Context: during the GST-charging bug (yesterday, 2026-10-01 IST) users whose
-- scheme slab is gst_inclusive=true were charged the base service charge WITHOUT
-- the 18% GST. This recovers the missing GST idempotently, never driving a wallet
-- negative (all-or-nothing): the full outstanding is debited only when the wallet
-- can cover it, otherwise it stays as a lien and is auto-recovered on funding via
-- a pg_cron sweep.
-- ============================================================================

-- 1) Dues ledger (one row per user+period). Idempotent via UNIQUE(entity_id, period).
create table if not exists gst_reconciliation_dues (
  id          uuid primary key default gen_random_uuid(),
  entity_id   text not null,
  entity_role text not null,
  wallet_type text not null default 'primary',
  period      text not null,
  total_owed  numeric(12,2) not null default 0,
  recovered   numeric(12,2) not null default 0,
  outstanding numeric(12,2) not null default 0,
  status      text not null default 'pending',       -- pending | settled
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (entity_id, period)
);

-- 2) Per-transaction audit (idempotent via UNIQUE(reference_id, period)).
create table if not exists gst_reconciliation_items (
  id            uuid primary key default gen_random_uuid(),
  due_id        uuid references gst_reconciliation_dues(id) on delete cascade,
  entity_id     text not null,
  period        text not null,
  reference_id  text not null,
  service_type  text not null,
  principal     numeric(12,2),
  base_charge   numeric(12,2),
  gst_owed      numeric(12,2),
  created_at    timestamptz not null default now(),
  unique (reference_id, period)
);

-- 3) Recovery sweep: all-or-nothing, idempotent, never negative.
create or replace function process_gst_recovery()
returns void
language plpgsql
security definer
as $$
declare
  d   record;
  bal numeric;
  ref text;
begin
  for d in
    select * from gst_reconciliation_dues
    where status = 'pending' and outstanding > 0
  loop
    ref := 'GSTREC_' || d.period || '_' || d.entity_id;
    begin
      -- Idempotency backstop: if a recovery entry already exists, mark settled.
      if exists (
        select 1 from wallet_ledger where reference_id = ref
        union all
        select 1 from partner_wallet_ledger where reference_id = ref
      ) then
        update gst_reconciliation_dues
          set recovered = total_owed, outstanding = 0, status = 'settled', updated_at = now()
          where id = d.id;
        continue;
      end if;

      if d.entity_role = 'partner' then
        select get_partner_wallet_balance(d.entity_id::uuid) into bal;
        if bal is not null and bal >= d.outstanding then
          perform debit_partner_wallet(
            d.entity_id::uuid, d.outstanding, null,
            'GST reconciliation for ' || d.period || ' (missed GST on pay2new/settlement-2 charges)',
            ref, 'gst_recovery');
          update gst_reconciliation_dues
            set recovered = total_owed, outstanding = 0, status = 'settled', updated_at = now()
            where id = d.id;
        end if;
      else
        select get_wallet_balance_v2(d.entity_id, d.wallet_type) into bal;
        if bal is not null and bal >= d.outstanding then
          perform add_ledger_entry(
            d.entity_id, d.entity_role, d.wallet_type, 'service', 'gst_recovery', 'GST_RECOVERY',
            0, d.outstanding, ref, null, 'completed',
            'GST reconciliation for ' || d.period || ' (missed GST on pay2new/settlement-2 charges)');
          update gst_reconciliation_dues
            set recovered = total_owed, outstanding = 0, status = 'settled', updated_at = now()
            where id = d.id;
        end if;
      end if;
    exception when others then
      raise warning 'GST recovery failed for % (%): %', d.entity_id, d.entity_role, sqlerrm;
    end;
  end loop;
end;
$$;

-- 4) Schedule the auto-recovery sweep every 15 minutes (requires pg_cron).
create extension if not exists pg_cron;
select cron.unschedule('gst-recovery-sweep')
  where exists (select 1 from cron.job where jobname = 'gst-recovery-sweep');
select cron.schedule('gst-recovery-sweep', '*/15 * * * *', $$select process_gst_recovery()$$);
