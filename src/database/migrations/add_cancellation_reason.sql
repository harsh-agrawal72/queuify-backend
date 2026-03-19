-- Add cancellation_reason column to appointments table
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
