# POS Assignment System – Verification Guide

Use this guide to confirm that the POS assignment, return, and history flow is working correctly.

---

## 1. Apply the database migration (one-time)

1. Open **Supabase Dashboard** → your project → **SQL Editor**.
2. Open the file `supabase-pos-assignment-fix-migration.sql` from this repo.
3. Copy its full contents and paste into the SQL Editor.
4. Click **Run**. It should complete without errors.
5. **Verify schema:**
   - Go to **Table Editor** → `pos_assignment_history`.
   - Confirm columns exist: `status`, `returned_date`.
   - In **Database** → **Functions**, confirm `return_pos_device`, `assign_pos_device`, `get_pos_stats` exist (optional; APIs work without them via fallback).

---

## 2. Test the APIs

Use **Browser DevTools (Network tab)** or **Postman/curl**. You must be **logged in as Admin** for admin endpoints.

### 2.1 Admin stats (dashboard counts)

```http
GET /api/admin/pos-machines/stats
```

- **Expected:** `200` with JSON like:
  ```json
  { "success": true, "stats": { "total": N, "in_stock": N, "assigned": N, "returned_history": N, ... } }
  ```
- If you see `stats` with numbers, the stats API is working.

### 2.2 List POS machines (my machines)

```http
GET /api/pos-machines/my-machines?page=1&limit=20
```

- **As Admin:** You get all machines (or filtered by your query).
- **As Retailer:** You get only machines where `retailer_id` = your partner_id and `inventory_status = assigned_to_retailer`.
- **Check:** Response has `data` array and `pagination`. No 401/403.

### 2.3 Assign a POS (Admin → Master Distributor or Partner)

1. Pick a machine that is **in_stock** (from my-machines or admin view).
2. Call:
   ```http
   POST /api/pos-machines/assign
   Content-Type: application/json

   {
     "machine_id": "<pos_machines.id UUID>",
     "assign_to": "<master_distributor partner_id or partner UUID>",
     "assign_to_type": "master_distributor",
     "notes": "Test assign"
   }
   ```
3. **Expected:** `200` with `{ "success": true, "message": "POS machine ... assigned to ..." }`.
4. **Verify in DB:**  
   - `pos_machines`: that row has `inventory_status = assigned_to_master_distributor` (or `assigned_to_partner`), and `master_distributor_id` / `partner_id` set.  
   - `pos_assignment_history`: new row with `action = assigned_to_master_distributor` (or `assigned_to_partner`), `status = active`.

### 2.4 Return a POS (Admin only)

1. Pick a machine that is **assigned** (e.g. `assigned_to_retailer` or `assigned_to_master_distributor`).
2. Call:
   ```http
   POST /api/admin/pos-machines/return
   Content-Type: application/json

   { "machine_id": "<pos_machines.id UUID>" }
   ```
3. **Expected:** `200` with `{ "success": true, "message": "Machine returned to stock successfully", "previous_status": "assigned_to_..." }`.
4. **Verify in DB:**  
   - `pos_machines`: that row has `inventory_status = in_stock`, `retailer_id` / `distributor_id` / `master_distributor_id` / `partner_id` all `NULL`.  
   - `pos_assignment_history`: the previous **active** assignment row for this device has `status = returned` and `returned_date` set; there is also a new row with action `unassigned_from_...`.

### 2.5 Reassign the same POS (same day)

1. Use the same machine you just returned (now `in_stock`).
2. Call **Assign** again with a **different** assign_to (e.g. another retailer or MD).
3. **Expected:** `200` and a new assignment.
4. **Verify in DB:**  
   - `pos_assignment_history`: **two** assignment rows for this device (first with `status = returned`, second with `status = active`). No overwriting of history.

### 2.6 History for one device

```http
GET /api/pos-machines/history/<pos_machines.id UUID>
```

- **Expected:** `200` with `{ "success": true, "machine": {...}, "history": [...], "nameMap": {...} }`.
- **As Admin:** Can use any POS id. **As Retailer/MD/Distributor:** Only for machines assigned to them (otherwise 403).

### 2.7 Admin history list (with filters)

```http
GET /api/admin/pos-machines/history?page=1&limit=20&assignment_status=active
```

- **Expected:** `200` with `data` array of history rows. Try `assignment_status=returned` to see only returned assignments.

---

## 3. Test in the UI

### 3.1 Admin dashboard

1. Log in as **Admin**.
2. Go to **POS Machines** tab (and **POS History** if you have it).
3. **Check:** You see total machines, in-stock vs assigned (if you wired stats into the UI).
4. **Assign:** Open a machine that is “In Stock” → Assign → choose Master Distributor or Partner → submit. You should see success and the machine move to “With Master Distributor” / “With Partner”.
5. **Return:** Use “Return to stock” (or equivalent) on an assigned machine. It should move back to “In Stock”.
6. **POS History tab:** You see rows with Assignment status (Active/Returned) and Returned date. Filter by “Returned” and confirm returned assignments show a date.

### 3.2 Retailer dashboard

1. Log in as a **Retailer** that has at least one POS assigned.
2. Open **My POS Machines** (or equivalent).
3. **Check:** Only machines currently assigned to that retailer appear (`inventory_status = assigned_to_retailer`). After you return one of their devices, it disappears from their list.

### 3.3 Same-day reassign flow

1. As Admin: Assign device A to Retailer 1.
2. As Admin: Return device A to stock.
3. As Admin: Assign the same device A to Retailer 2.
4. **Check:**  
   - Retailer 1 no longer sees device A.  
   - Retailer 2 sees device A.  
   - Admin history for that device shows two assignment records (one returned, one active).

---

## 4. Quick checklist

| Check | How to verify |
|-------|----------------|
| Migration applied | `pos_assignment_history` has `status`, `returned_date` columns. |
| Assign works | POST assign → 200, `pos_machines` updated, new history row with `status=active`. |
| Return works | POST return → 200, device goes to in_stock, active assignment gets `status=returned` and `returned_date`. |
| Reassign creates new row | After return, assign again → second history row (first remains returned). |
| Retailer sees only own | Retailer role: my-machines returns only their assigned devices. |
| Admin stats | GET `/api/admin/pos-machines/stats` returns total, in_stock, assigned, returned_history. |
| Per-device history | GET `/api/pos-machines/history/{id}` returns machine + full history. |

---

## 5. Common issues

- **401 on APIs:** Session expired or not logged in. Log in again in the same browser (or send auth cookie/header).
- **403 on return or stats:** User is not Admin. Use an admin account.
- **“Machine cannot be returned”:** Device is already `in_stock`. Only assigned devices can be returned.
- **“Machine is currently … Only in_stock … can be assigned”:** You’re trying to assign a device that’s already assigned. Return it first, then assign.
- **RPC not found (e.g. return_pos_device):** Migration not run or failed. APIs still work via fallback; run the migration to get atomic behavior.
- **History missing status/returned_date:** Old rows may have NULL. New assignments/returns will have them. Re-run migration backfill if needed.

---

## 6. Optional: curl examples (replace placeholders)

```bash
# Set your app base URL and ensure you're logged in (cookie or token)
BASE="http://localhost:3000"

# Stats (admin)
curl -s "$BASE/api/admin/pos-machines/stats" -H "Cookie: <your-session-cookie>"

# Return (admin) – replace MACHINE_UUID
curl -s -X POST "$BASE/api/admin/pos-machines/return" \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{"machine_id":"MACHINE_UUID"}'

# History for one device – replace POS_UUID
curl -s "$BASE/api/pos-machines/history/POS_UUID" -H "Cookie: <your-session-cookie>"
```

Using the **browser** while logged in is often easiest: open the same URLs in a new tab and inspect the JSON response, or use **Application → Cookies** to copy the session cookie for curl.

Once these steps pass, the POS assignment, return, and history flow is working as intended.
