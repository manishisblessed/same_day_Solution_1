import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const dynamic = 'force-dynamic'

/** Normalize CSV date to YYYY-MM-DD for Postgres DATE columns. Supports ISO and DD/MM/YYYY (or DD-MM-YYYY). */
function parseCsvDateToIso(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) {
    const [y, mo, d] = t.split('-').map(Number)
    const dt = new Date(Date.UTC(y, mo - 1, d))
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
    return null
  }
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) {
    const d = parseInt(m[1], 10)
    const mo = parseInt(m[2], 10)
    const y = parseInt(m[3], 10)
    const dt = new Date(Date.UTC(y, mo - 1, d))
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }
  return null
}

function optionalCsvDate(raw: string | undefined, rowLabel: string): { iso?: string; error?: string } {
  if (raw === undefined || raw === null) return {}
  const s = String(raw).trim()
  if (!s) return {}
  const iso = parseCsvDateToIso(s)
  if (!iso) return { error: `${rowLabel}: invalid date "${raw}" (use YYYY-MM-DD or DD/MM/YYYY)` }
  return { iso }
}

/** Stock bulk upload: warehouse intake only — no retailer / distributor / master_distributor columns. */
const STOCK_BULK_HEADERS = [
  'serial_number',
  'mid',
  'tid',
  'brand',
  'machine_type',
  'inventory_status',
  'status',
  'delivery_date',
  'installation_date',
  'location',
  'city',
  'state',
  'pincode',
  'notes',
] as const

const STOCK_ONLY_STATUS = 'in_stock'

/**
 * Bulk upload POS machines from CSV
 * 
 * Authorization: Admin only
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication with fallback
    const { user, method } = await getCurrentUserWithFallback(request)
    console.log('[Bulk Upload POS] Auth method:', method, '| User:', user?.email || 'none')
    
    if (!user) {
      return NextResponse.json(
        { error: 'Session expired. Please log out and log back in.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      )
    }
    
    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 403 }
      )
    }

    const formData = await request.formData()
    const entry = (formData as unknown as { get(name: string): File | string | null }).get('file')
    const file = entry instanceof File ? entry : null

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    const lowerName = file.name.toLowerCase()
    if (!lowerName.endsWith('.csv') && !lowerName.endsWith('.tsv')) {
      return NextResponse.json(
        { error: 'Invalid file type. Use a .csv or .tsv file (comma or tab separated).' },
        { status: 400 }
      )
    }

    // Read and parse CSV (strip UTF-8 BOM so headers match when exported from Excel)
    const text = (await file.text()).replace(/^\uFEFF/, '')
    const lines = text.split(/\r?\n/).filter(line => line.trim())
    
    if (lines.length < 2) {
      return NextResponse.json(
        { error: 'CSV file must contain at least a header row and one data row' },
        { status: 400 }
      )
    }

    // Helper: parse comma-separated line (handles quoted values)
    const parseCSVLine = (line: string): string[] => {
      const result: string[] = []
      let current = ''
      let inQuotes = false

      for (let i = 0; i < line.length; i++) {
        const char = line[i]

        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"'
            i++
          } else {
            inQuotes = !inQuotes
          }
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim())
          current = ''
        } else {
          current += char
        }
      }

      result.push(current.trim())
      return result
    }

    const tabCount = (lines[0].match(/\t/g) || []).length
    const commaCount = (lines[0].match(/,/g) || []).length
    const useTabDelimiter = tabCount > commaCount

    const splitDataLine = (line: string): string[] => {
      const cells = useTabDelimiter
        ? line.split('\t').map((c) => c.replace(/^"|"$/g, '').trim())
        : parseCSVLine(line).map((c) => c.replace(/^"|"$/g, '').trim())
      return cells
    }

    // Parse header (normalize to lowercase; tolerate BOM in first cell)
    const header = splitDataLine(lines[0]).map((h) =>
      h.replace(/^"|"$/g, '').replace(/^\uFEFF/, '').trim().toLowerCase()
    )
    const headerSet = new Set(header)

    const missingStock = STOCK_BULK_HEADERS.filter((h) => !headerSet.has(h))
    if (missingStock.length > 0) {
      return NextResponse.json(
        {
          error: 'CSV does not match the stock bulk upload template.',
          detail: `Missing columns: ${missingStock.join(', ')}. Use Admin → Download Template (stock intake: no retailer/distributor/master_distributor columns). Required: ${STOCK_BULK_HEADERS.join(', ')}.`,
        },
        { status: 400 }
      )
    }

    // Parse data rows → DB insert payloads
    const insertRows: Record<string, unknown>[] = []
    const errors: string[] = []
    const validMachineIds = new Set<string>()
    const validSerialNumbers = new Set<string>()

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      const values = splitDataLine(line)
      const row: Record<string, string> = {}

      header.forEach((col, index) => {
        row[col] = values[index] ?? ''
      })

      const mid = row.mid ? String(row.mid).trim() : ''
      const tid = row.tid ? String(row.tid).trim() : ''
      if (!mid) {
        errors.push(`Row ${i + 1}: MID is required`)
        continue
      }
      if (!tid) {
        errors.push(`Row ${i + 1}: TID is required`)
        continue
      }

      const machineId = `${mid}_${tid}`
      row.machine_id = machineId

      if (validMachineIds.has(row.machine_id)) {
        errors.push(`Row ${i + 1}: Duplicate machine_id "${row.machine_id}" in CSV`)
        continue
      }
      validMachineIds.add(row.machine_id)

      row.serial_number = row.serial_number ? String(row.serial_number).trim() : ''
      if (!row.serial_number) {
        errors.push(`Row ${i + 1}: serial_number is required`)
        continue
      }

      const inv = row.inventory_status ? String(row.inventory_status).trim().toLowerCase() : ''
      if (inv !== STOCK_ONLY_STATUS) {
        errors.push(
          `Row ${i + 1}: inventory_status must be "${STOCK_ONLY_STATUS}" for bulk upload (got "${row.inventory_status || '(empty)'}"). Assign retailers via POS assignment, not this upload.`
        )
        continue
      }

      const deliveryParsed = optionalCsvDate(row.delivery_date, `Row ${i + 1} delivery_date`)
      if (deliveryParsed.error) {
        errors.push(deliveryParsed.error)
        continue
      }
      const installParsed = optionalCsvDate(row.installation_date, `Row ${i + 1} installation_date`)
      if (installParsed.error) {
        errors.push(installParsed.error)
        continue
      }

      // Check for duplicate serial_number in CSV
      if (row.serial_number && validSerialNumbers.has(row.serial_number)) {
        errors.push(`Row ${i + 1}: Duplicate serial_number "${row.serial_number}" in CSV`)
        continue
      }
      if (row.serial_number) {
        validSerialNumbers.add(row.serial_number)
      }

      // Validate machine_type
      const mt = row.machine_type ? String(row.machine_type).trim() : 'POS'
      if (!['POS', 'WPOS', 'Mini-ATM'].includes(mt)) {
        errors.push(`Row ${i + 1}: Invalid machine_type "${row.machine_type}". Must be POS, WPOS, or Mini-ATM`)
        continue
      }

      // Validate status
      if (row.status && !['active', 'inactive', 'maintenance', 'damaged', 'returned'].includes(String(row.status).trim())) {
        errors.push(`Row ${i + 1}: Invalid status "${row.status}"`)
        continue
      }

      const { data: existingMachine } = await supabaseAdmin
        .from('pos_machines')
        .select('machine_id')
        .eq('machine_id', row.machine_id)
        .maybeSingle()

      if (existingMachine) {
        errors.push(`Row ${i + 1}: Machine ID "${row.machine_id}" (MID_TID) already exists in the database`)
        continue
      }

      const { data: existingSerial } = await supabaseAdmin
        .from('pos_machines')
        .select('serial_number')
        .eq('serial_number', row.serial_number)
        .maybeSingle()

      if (existingSerial) {
        errors.push(`Row ${i + 1}: Serial number "${row.serial_number}" already exists in the database`)
        continue
      }

      const posMachineData: Record<string, unknown> = {
        machine_id: row.machine_id,
        machine_type: mt,
        status: row.status ? String(row.status).trim() : 'active',
        inventory_status: STOCK_ONLY_STATUS,
        retailer_id: null,
        distributor_id: null,
        master_distributor_id: null,
        partner_id: null,
        serial_number: row.serial_number,
      }
      if (deliveryParsed.iso) posMachineData.delivery_date = deliveryParsed.iso
      if (installParsed.iso) posMachineData.installation_date = installParsed.iso
      if (row.location) posMachineData.location = String(row.location).trim()
      if (row.city) posMachineData.city = String(row.city).trim()
      if (row.state) posMachineData.state = String(row.state).trim()
      if (row.pincode) posMachineData.pincode = String(row.pincode).trim()
      if (row.notes) posMachineData.notes = String(row.notes).trim()
      if (row.brand) posMachineData.brand = String(row.brand).trim()
      posMachineData.mid = mid
      posMachineData.tid = tid

      insertRows.push(posMachineData)
    }

    // If there are validation errors, return them
    if (errors.length > 0) {
      return NextResponse.json(
        { 
          error: 'Validation errors found',
          errors,
          validRows: insertRows.length
        },
        { status: 400 }
      )
    }

    if (insertRows.length === 0) {
      return NextResponse.json(
        { error: 'No valid rows to import' },
        { status: 400 }
      )
    }

    // Insert all valid rows in a transaction
    const { data: insertedMachines, error: insertError } = await supabaseAdmin
      .from('pos_machines')
      .insert(insertRows)
      .select()

    if (insertError) {
      console.error('Error inserting POS machines:', insertError)
      return NextResponse.json(
        { error: `Failed to insert POS machines: ${insertError.message}` },
        { status: 500 }
      )
    }

    // POS History: one "created" row per machine (stock intake) + Performance: single activity_logs row
    if (insertedMachines && insertedMachines.length > 0) {
      const batchRef = `${Date.now().toString(36)}`
      const batchNote = `Bulk stock upload [${batchRef}] · ${insertedMachines.length} machine(s) in file`

      const historyRecords = insertedMachines.map((m: { id: string; machine_id: string }) => ({
        pos_machine_id: m.id,
        machine_id: m.machine_id,
        action: 'created' as const,
        assigned_by: user.email,
        assigned_by_role: 'admin',
        assigned_to: null,
        assigned_to_role: null,
        status: 'returned',
        notes: batchNote,
      }))

      const { error: histError } = await supabaseAdmin
        .from('pos_assignment_history')
        .insert(historyRecords)
      if (histError) {
        console.warn('[Bulk Upload POS] Failed to create history records:', histError)
      }

      try {
        const ctx = getRequestContext(request)
        void logActivityFromContext(ctx, user, {
          activity_type: 'pos_machine_bulk_upload',
          activity_category: 'pos',
          activity_description: `Bulk uploaded ${insertedMachines.length} POS machine(s) to stock [${batchRef}]`,
          reference_table: 'pos_machines',
          reference_id: insertedMachines[0]?.id,
          metadata: {
            batch_ref: batchRef,
            count: insertedMachines.length,
            machine_ids: insertedMachines.map((m: { machine_id: string }) => m.machine_id).slice(0, 100),
          },
        })
      } catch (_) {
        /* logging is best-effort */
      }
    }

    return NextResponse.json({
      success: true,
      message: `Successfully imported ${insertedMachines?.length || 0} POS machine(s)`,
      count: insertedMachines?.length || 0,
      machines: insertedMachines
    })

  } catch (error: any) {
    console.error('[Bulk Upload POS Machines API] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to process CSV file' },
      { status: 500 }
    )
  }
}

