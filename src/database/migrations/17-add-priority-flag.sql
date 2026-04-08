-- 17-add-priority-flag.sql
-- Add is_priority column to appointments table to support Premium membership features
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS is_priority BOOLEAN DEFAULT FALSE;
