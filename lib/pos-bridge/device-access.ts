import type { SupabaseClient } from '@supabase/supabase-js'

export function serialFromDeviceId(deviceId: string): string {
  const s = deviceId.trim()
  const i = s.indexOf('|')
  return i === -1 ? s : s.slice(0, i)
}

export function toEzetapDeviceId(serialOrFull: string): string {
  const s = serialOrFull.trim()
  if (s.includes('|')) return s
  return `${s}|ezetap_android`
}

/**
 * Serial numbers this retailer may use for POS Bridge (Ezetap push / cancel).
 */
export async function getRetailerDeviceSerials(
  supabase: SupabaseClient,
  retailerId: string
): Promise<string[]> {
  const serials = new Set<string>()

  const { data: map } = await supabase
    .from('pos_device_mapping')
    .select('device_serial')
    .eq('retailer_id', retailerId)
    .eq('status', 'ACTIVE')

  map?.forEach((r: { device_serial?: string }) => {
    if (r.device_serial) serials.add(String(r.device_serial))
  })

  const { data: machines } = await supabase
    .from('pos_machines')
    .select('serial_number')
    .eq('retailer_id', retailerId)
    .in('status', ['active', 'inactive'])

  machines?.forEach((m: { serial_number?: string }) => {
    if (m.serial_number) serials.add(String(m.serial_number))
  })

  return Array.from(serials)
}

export async function retailerOwnsDevice(
  supabase: SupabaseClient,
  retailerId: string,
  deviceSerialOrFullId: string
): Promise<boolean> {
  const serial = serialFromDeviceId(deviceSerialOrFullId)
  const allowed = await getRetailerDeviceSerials(supabase, retailerId)
  return allowed.includes(serial)
}
