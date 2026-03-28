-- Migration to add missing columns for cancellation and deletion tracking
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(50),
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
ADD COLUMN IF NOT EXISTS is_deleted_permanent BOOLEAN DEFAULT FALSE;

-- Ensure indices for faster lookups
CREATE INDEX IF NOT EXISTS idx_appointments_status_org ON appointments(org_id, status);
