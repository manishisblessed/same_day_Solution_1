-- Migration: Add transit_date and delivered_date to pos_assignment_history
-- transit_date = when device was dispatched/shipped
-- delivered_date = when device reached the destination
-- Run after: supabase-pos-history-date-fix-migration.sql

ALTER TABLE pos_assignment_history
  ADD COLUMN IF NOT EXISTS transit_date timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_date timestamptz;

CREATE INDEX IF NOT EXISTS idx_pos_assignment_history_transit_date
ON pos_assignment_history(transit_date);

CREATE INDEX IF NOT EXISTS idx_pos_assignment_history_delivered_date
ON pos_assignment_history(delivered_date);
