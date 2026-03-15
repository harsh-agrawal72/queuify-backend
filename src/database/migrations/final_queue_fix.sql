-- CRITICAL FIX: Add missing columns for Advanced Queue Math
-- Run this in your Neon DB SQL Editor

ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS serving_started_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;

-- Also ensure services has queue_scope (just in case)
ALTER TABLE services
ADD COLUMN IF NOT EXISTS queue_scope VARCHAR(50) DEFAULT 'CENTRAL';

-- Add index for performance on queue status lookups
CREATE INDEX IF NOT EXISTS idx_appointments_serving_time ON appointments(serving_started_at);
CREATE INDEX IF NOT EXISTS idx_appointments_completed_time ON appointments(completed_at);
