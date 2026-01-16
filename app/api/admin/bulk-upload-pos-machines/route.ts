import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

interface CSVRow {
  machine_id: string
  serial_number?: string
  retailer_id: string
  distributor_id?: string
  master_distributor_id?: string
  machine_type: 'POS' | 'WPOS' | 'Mini-ATM'
  inventory_status?: 'in_stock' | 'received_from_bank' | 'assigned_to_master_distributor' | 'assigned_to_distributor' | 'assigned_to_retailer' | 'damaged_from_bank'
  status?: 'active' | 'inactive' | 'maintenance' | 'damaged' | 'returned'
  delivery_date?: string
  installation_date?: string
  location?: string
  city?: string
  state?: string
  pincode?: string
  notes?: string
}

/**
 * Bulk upload POS machines from CSV
 * 
 * Authorization: Admin only
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const user = await getCurrentUserServer()
    
    if (!user || user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 401 }
      )
    }

    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    // Validate file type
    if (!file.name.endsWith('.csv')) {
      return NextResponse.json(
        { error: 'Invalid file type. Only CSV files are allowed' },
        { status: 400 }
      )
    }

    // Read and parse CSV
    const text = await file.text()
    const lines = text.split('\n').filter(line => line.trim())
    
    if (lines.length < 2) {
      return NextResponse.json(
        { error: 'CSV file must contain at least a header row and one data row' },
        { status: 400 }
      )
    }

    // Helper function to parse CSV line (handles quoted values)
    const parseCSVLine = (line: string): string[] => {
      const result: string[] = []
      let current = ''
      let inQuotes = false
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i]
        
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            // Escaped quote
            current += '"'
            i++
          } else {
            // Toggle quote state
            inQuotes = !inQuotes
          }
        } else if (char === ',' && !inQuotes) {
          // End of field
          result.push(current.trim())
          current = ''
        } else {
          current += char
        }
      }
      
      // Add last field
      result.push(current.trim())
      return result
    }

    // Parse header
    const header = parseCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim().toLowerCase())
    const requiredFields = ['machine_id', 'retailer_id']
    const missingFields = requiredFields.filter(field => !header.includes(field))
    
    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Missing required columns: ${missingFields.join(', ')}` },
        { status: 400 }
      )
    }

    // Parse data rows
    const rows: CSVRow[] = []
    const errors: string[] = []
    const validMachineIds = new Set<string>()
    const validSerialNumbers = new Set<string>()

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      const values = parseCSVLine(line).map(v => v.replace(/^"|"$/g, '').trim())
      const row: any = {}

      // Map CSV columns to row object
      header.forEach((col, index) => {
        const value = values[index] || ''
        row[col] = value
      })

      // Validate required fields
      if (!row.machine_id) {
        errors.push(`Row ${i + 1}: machine_id is required`)
        continue
      }

      // Check for duplicate machine_id in CSV
      if (validMachineIds.has(row.machine_id)) {
        errors.push(`Row ${i + 1}: Duplicate machine_id "${row.machine_id}" in CSV`)
        continue
      }
      validMachineIds.add(row.machine_id)

      // Check for duplicate serial_number in CSV
      if (row.serial_number && validSerialNumbers.has(row.serial_number)) {
        errors.push(`Row ${i + 1}: Duplicate serial_number "${row.serial_number}" in CSV`)
        continue
      }
      if (row.serial_number) {
        validSerialNumbers.add(row.serial_number)
      }

      // Validate machine_type
      if (row.machine_type && !['POS', 'WPOS', 'Mini-ATM'].includes(row.machine_type)) {
        errors.push(`Row ${i + 1}: Invalid machine_type "${row.machine_type}". Must be POS, WPOS, or Mini-ATM`)
        continue
      }

      // Validate inventory_status
      if (row.inventory_status && !['in_stock', 'received_from_bank', 'assigned_to_master_distributor', 'assigned_to_distributor', 'assigned_to_retailer', 'damaged_from_bank'].includes(row.inventory_status)) {
        errors.push(`Row ${i + 1}: Invalid inventory_status "${row.inventory_status}"`)
        continue
      }

      // Validate status
      if (row.status && !['active', 'inactive', 'maintenance', 'damaged', 'returned'].includes(row.status)) {
        errors.push(`Row ${i + 1}: Invalid status "${row.status}"`)
        continue
      }

      // Validate retailer_id exists
      if (row.retailer_id) {
        const { data: retailer } = await supabaseAdmin
          .from('retailers')
          .select('partner_id')
          .eq('partner_id', row.retailer_id)
          .single()

        if (!retailer) {
          errors.push(`Row ${i + 1}: Retailer ID "${row.retailer_id}" not found`)
          continue
        }
      }

      // Validate distributor_id exists if provided
      if (row.distributor_id) {
        const { data: distributor } = await supabaseAdmin
          .from('distributors')
          .select('partner_id')
          .eq('partner_id', row.distributor_id)
          .single()

        if (!distributor) {
          errors.push(`Row ${i + 1}: Distributor ID "${row.distributor_id}" not found`)
          continue
        }
      }

      // Validate master_distributor_id exists if provided
      if (row.master_distributor_id) {
        const { data: masterDistributor } = await supabaseAdmin
          .from('master_distributors')
          .select('partner_id')
          .eq('partner_id', row.master_distributor_id)
          .single()

        if (!masterDistributor) {
          errors.push(`Row ${i + 1}: Master Distributor ID "${row.master_distributor_id}" not found`)
          continue
        }
      }

      // Check if machine_id already exists in database
      const { data: existingMachine } = await supabaseAdmin
        .from('pos_machines')
        .select('machine_id')
        .eq('machine_id', row.machine_id)
        .single()

      if (existingMachine) {
        errors.push(`Row ${i + 1}: Machine ID "${row.machine_id}" already exists`)
        continue
      }

      // Check if serial_number already exists in database
      if (row.serial_number) {
        const { data: existingSerial } = await supabaseAdmin
          .from('pos_machines')
          .select('serial_number')
          .eq('serial_number', row.serial_number)
          .single()

        if (existingSerial) {
          errors.push(`Row ${i + 1}: Serial Number "${row.serial_number}" already exists`)
          continue
        }
      }

      // Prepare data for insertion
      const posMachineData: any = {
        machine_id: row.machine_id,
        retailer_id: row.retailer_id,
        machine_type: row.machine_type || 'POS',
        status: row.status || 'active',
        inventory_status: row.inventory_status || 'in_stock',
      }

      // Add optional fields
      if (row.serial_number) posMachineData.serial_number = row.serial_number
      if (row.distributor_id) posMachineData.distributor_id = row.distributor_id
      if (row.master_distributor_id) posMachineData.master_distributor_id = row.master_distributor_id
      if (row.delivery_date) posMachineData.delivery_date = row.delivery_date
      if (row.installation_date) posMachineData.installation_date = row.installation_date
      if (row.location) posMachineData.location = row.location
      if (row.city) posMachineData.city = row.city
      if (row.state) posMachineData.state = row.state
      if (row.pincode) posMachineData.pincode = row.pincode
      if (row.notes) posMachineData.notes = row.notes

      rows.push(posMachineData)
    }

    // If there are validation errors, return them
    if (errors.length > 0) {
      return NextResponse.json(
        { 
          error: 'Validation errors found',
          errors,
          validRows: rows.length
        },
        { status: 400 }
      )
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No valid rows to import' },
        { status: 400 }
      )
    }

    // Insert all valid rows in a transaction
    const { data: insertedMachines, error: insertError } = await supabaseAdmin
      .from('pos_machines')
      .insert(rows)
      .select()

    if (insertError) {
      console.error('Error inserting POS machines:', insertError)
      return NextResponse.json(
        { error: `Failed to insert POS machines: ${insertError.message}` },
        { status: 500 }
      )
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

