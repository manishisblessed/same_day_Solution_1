export type UserRole = 'retailer' | 'distributor' | 'master_distributor' | 'admin'

export interface Retailer {
  id: string
  partner_id: string
  name: string
  email: string
  phone: string
  business_name?: string
  address?: string
  city?: string
  state?: string
  pincode?: string
  gst_number?: string
  distributor_id?: string
  master_distributor_id?: string
  status: 'active' | 'inactive' | 'suspended'
  commission_rate?: number
  created_at: string
  updated_at: string
}

export interface Distributor {
  id: string
  partner_id: string
  name: string
  email: string
  phone: string
  business_name?: string
  address?: string
  city?: string
  state?: string
  pincode?: string
  gst_number?: string
  master_distributor_id?: string
  status: 'active' | 'inactive' | 'suspended'
  commission_rate?: number
  created_at: string
  updated_at: string
}

export interface MasterDistributor {
  id: string
  partner_id: string
  name: string
  email: string
  phone: string
  business_name?: string
  address?: string
  city?: string
  state?: string
  pincode?: string
  gst_number?: string
  status: 'active' | 'inactive' | 'suspended'
  commission_rate?: number
  created_at: string
  updated_at: string
}

export interface AdminUser {
  id: string
  email: string
  name: string
  role: 'admin'
  created_at: string
}

export interface AuthUser {
  id: string
  email: string
  role: UserRole
  partner_id?: string
  name?: string
}

export interface POSMachine {
  id: string
  machine_id: string
  serial_number?: string
  retailer_id: string
  distributor_id?: string
  master_distributor_id?: string
  machine_type: 'POS' | 'WPOS' | 'Mini-ATM'
  status: 'active' | 'inactive' | 'maintenance' | 'damaged' | 'returned'
  delivery_date?: string
  installation_date?: string
  location?: string
  city?: string
  state?: string
  pincode?: string
  notes?: string
  created_at: string
  updated_at: string
}

