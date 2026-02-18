# Database Migrations Required for POS Features

## ✅ MIGRATIONS TO RUN (In Order)

You need to run **2 migrations** in your Supabase database to enable all POS features:

---

## 📋 Migration 1: Hierarchical Assignment Flow

**File**: `supabase-pos-hierarchical-assignment-migration.sql`

**Purpose**: Enables the hierarchical POS assignment flow (Admin → MD → Distributor → Retailer)

**What it does:**
- Makes `retailer_id` nullable (allows machines to be assigned to MD/Distributor without a retailer)
- Adds assignment tracking columns (`assigned_by`, `assigned_by_role`, `last_assigned_at`)
- Creates `pos_assignment_history` table for audit trail
- Updates existing records with proper `inventory_status`

**Run this FIRST** ⬇️

---

## 📋 Migration 2: MID, TID, and BRAND Fields

**File**: `supabase-pos-add-mid-tid-brand-migration.sql`

**Purpose**: Adds MID (Merchant ID), TID (Terminal ID), and BRAND fields to POS machines

**What it does:**
- Adds `mid` column (TEXT) - Merchant ID
- Adds `tid` column (TEXT) - Terminal ID  
- Adds `brand` column (TEXT with CHECK constraint) - RAZORPAY, PINELAB, PAYTM, ICICI, HDFC, AXIS, OTHER
- Creates indexes for performance
- Adds column comments

**Run this SECOND** ⬇️

---

## 🚀 HOW TO RUN

### Option 1: Supabase Dashboard (Recommended)

1. Go to your **Supabase Dashboard** → **SQL Editor**
2. Open **Migration 1** file: `supabase-pos-hierarchical-assignment-migration.sql`
3. Copy the entire SQL content
4. Paste into SQL Editor and click **Run**
5. Wait for success confirmation
6. Open **Migration 2** file: `supabase-pos-add-mid-tid-brand-migration.sql`
7. Copy the entire SQL content
8. Paste into SQL Editor and click **Run**
9. Wait for success confirmation

### Option 2: Supabase CLI

```bash
# Run migration 1
supabase db push --file supabase-pos-hierarchical-assignment-migration.sql

# Run migration 2
supabase db push --file supabase-pos-add-mid-tid-brand-migration.sql
```

---

## ✅ VERIFICATION

After running both migrations, verify in Supabase:

1. **Check `pos_machines` table structure:**
   - Should have: `mid`, `tid`, `brand` columns
   - Should have: `assigned_by`, `assigned_by_role`, `last_assigned_at` columns
   - `retailer_id` should be nullable

2. **Check `pos_assignment_history` table:**
   - Table should exist
   - Should have all columns as defined in migration 1

3. **Check indexes:**
   - `idx_pos_machines_mid`
   - `idx_pos_machines_tid`
   - `idx_pos_machines_brand`
   - All `pos_assignment_history` indexes

---

## ⚠️ IMPORTANT NOTES

- Both migrations use `IF NOT EXISTS` clauses, so they're **safe to run multiple times**
- If you've already run Migration 1, you can still run Migration 2 independently
- The migrations are **non-destructive** - they only add columns/tables, not remove data
- Existing data will remain intact

---

## 📝 MIGRATION ORDER SUMMARY

```
1. supabase-pos-hierarchical-assignment-migration.sql  ← Run FIRST
2. supabase-pos-add-mid-tid-brand-migration.sql       ← Run SECOND
```

---

**Status**: Ready to deploy ✅
**Last Updated**: 2026-02-17

