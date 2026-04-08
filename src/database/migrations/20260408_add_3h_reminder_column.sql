-- Add three_hour_reminder_sent column to appointments table
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS three_hour_reminder_sent BOOLEAN DEFAULT FALSE;
