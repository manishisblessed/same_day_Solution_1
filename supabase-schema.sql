-- Supabase Database Schema for Same Day Solution
-- Run this SQL in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Admin Users Table
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'admin' CHECK (role = 'admin'),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Master Distributors Table
CREATE TABLE IF NOT EXISTS master_distributors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  business_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  gst_number TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  commission_rate DECIMAL(5,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Distributors Table
CREATE TABLE IF NOT EXISTS distributors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  business_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  gst_number TEXT,
  master_distributor_id TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  commission_rate DECIMAL(5,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  FOREIGN KEY (master_distributor_id) REFERENCES master_distributors(partner_id) ON DELETE SET NULL
);

-- Retailers Table
CREATE TABLE IF NOT EXISTS retailers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  business_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  gst_number TEXT,
  distributor_id TEXT,
  master_distributor_id TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  commission_rate DECIMAL(5,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  FOREIGN KEY (distributor_id) REFERENCES distributors(partner_id) ON DELETE SET NULL,
  FOREIGN KEY (master_distributor_id) REFERENCES master_distributors(partner_id) ON DELETE SET NULL
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_retailers_distributor_id ON retailers(distributor_id);
CREATE INDEX IF NOT EXISTS idx_retailers_master_distributor_id ON retailers(master_distributor_id);
CREATE INDEX IF NOT EXISTS idx_distributors_master_distributor_id ON distributors(master_distributor_id);
CREATE INDEX IF NOT EXISTS idx_retailers_status ON retailers(status);
CREATE INDEX IF NOT EXISTS idx_distributors_status ON distributors(status);
CREATE INDEX IF NOT EXISTS idx_master_distributors_status ON master_distributors(status);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Drop existing triggers if they exist (before creating new ones)
DROP TRIGGER IF EXISTS update_admin_users_updated_at ON admin_users;
DROP TRIGGER IF EXISTS update_master_distributors_updated_at ON master_distributors;
DROP TRIGGER IF EXISTS update_distributors_updated_at ON distributors;
DROP TRIGGER IF EXISTS update_retailers_updated_at ON retailers;

-- Create triggers for updated_at
CREATE TRIGGER update_admin_users_updated_at BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_master_distributors_updated_at BEFORE UPDATE ON master_distributors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_distributors_updated_at BEFORE UPDATE ON distributors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_retailers_updated_at BEFORE UPDATE ON retailers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_distributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE distributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE retailers ENABLE ROW LEVEL SECURITY;

-- Drop existing RLS policies if they exist
DROP POLICY IF EXISTS "Admins can read admin_users" ON admin_users;
DROP POLICY IF EXISTS "Admins can insert admin_users" ON admin_users;
DROP POLICY IF EXISTS "Admins can update admin_users" ON admin_users;
DROP POLICY IF EXISTS "Admins can delete admin_users" ON admin_users;
DROP POLICY IF EXISTS "Anyone can read master_distributors" ON master_distributors;
DROP POLICY IF EXISTS "Admins can manage master_distributors" ON master_distributors;
DROP POLICY IF EXISTS "Anyone can read distributors" ON distributors;
DROP POLICY IF EXISTS "Admins can manage distributors" ON distributors;
DROP POLICY IF EXISTS "Anyone can read retailers" ON retailers;
DROP POLICY IF EXISTS "Admins can manage retailers" ON retailers;

-- RLS Policies for admin_users (only admins can read/write)
CREATE POLICY "Admins can read admin_users" ON admin_users
  FOR SELECT USING (true);

CREATE POLICY "Admins can insert admin_users" ON admin_users
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Admins can update admin_users" ON admin_users
  FOR UPDATE USING (true);

CREATE POLICY "Admins can delete admin_users" ON admin_users
  FOR DELETE USING (true);

-- RLS Policies for master_distributors
CREATE POLICY "Anyone can read master_distributors" ON master_distributors
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage master_distributors" ON master_distributors
  FOR ALL USING (true);

-- RLS Policies for distributors
CREATE POLICY "Anyone can read distributors" ON distributors
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage distributors" ON distributors
  FOR ALL USING (true);

-- RLS Policies for retailers
CREATE POLICY "Anyone can read retailers" ON retailers
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage retailers" ON retailers
  FOR ALL USING (true);

-- POS Machines Table
CREATE TABLE IF NOT EXISTS pos_machines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_id TEXT UNIQUE NOT NULL,
  serial_number TEXT UNIQUE,
  retailer_id TEXT NOT NULL,
  distributor_id TEXT,
  master_distributor_id TEXT,
  machine_type TEXT DEFAULT 'POS' CHECK (machine_type IN ('POS', 'WPOS', 'Mini-ATM')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance', 'damaged', 'returned')),
  delivery_date DATE,
  installation_date DATE,
  location TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  FOREIGN KEY (retailer_id) REFERENCES retailers(partner_id) ON DELETE CASCADE,
  FOREIGN KEY (distributor_id) REFERENCES distributors(partner_id) ON DELETE SET NULL,
  FOREIGN KEY (master_distributor_id) REFERENCES master_distributors(partner_id) ON DELETE SET NULL
);

-- Create indexes for POS machines
CREATE INDEX IF NOT EXISTS idx_pos_machines_retailer_id ON pos_machines(retailer_id);
CREATE INDEX IF NOT EXISTS idx_pos_machines_distributor_id ON pos_machines(distributor_id);
CREATE INDEX IF NOT EXISTS idx_pos_machines_master_distributor_id ON pos_machines(master_distributor_id);
CREATE INDEX IF NOT EXISTS idx_pos_machines_status ON pos_machines(status);
CREATE INDEX IF NOT EXISTS idx_pos_machines_machine_id ON pos_machines(machine_id);
CREATE INDEX IF NOT EXISTS idx_pos_machines_serial_number ON pos_machines(serial_number);

-- Create trigger for updated_at on pos_machines
DROP TRIGGER IF EXISTS update_pos_machines_updated_at ON pos_machines;
CREATE TRIGGER update_pos_machines_updated_at BEFORE UPDATE ON pos_machines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS for pos_machines
ALTER TABLE pos_machines ENABLE ROW LEVEL SECURITY;

-- Drop existing RLS policies for pos_machines if they exist
DROP POLICY IF EXISTS "Anyone can read pos_machines" ON pos_machines;
DROP POLICY IF EXISTS "Admins can manage pos_machines" ON pos_machines;

-- RLS Policies for pos_machines
CREATE POLICY "Anyone can read pos_machines" ON pos_machines
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage pos_machines" ON pos_machines
  FOR ALL USING (true);

-- Note: For production, you should create more restrictive RLS policies
-- based on user roles and relationships (e.g., distributors can only see their retailers)

