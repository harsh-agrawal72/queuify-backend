-- Run this script in your Neon DB SQL Editor to add the missing columns

-- 1. Organizations missing columns
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS open_time VARCHAR(20),
ADD COLUMN IF NOT EXISTS close_time VARCHAR(20),
ADD COLUMN IF NOT EXISTS email_notification BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS new_booking_notification BOOLEAN DEFAULT true;

-- Ensure queue_scope type exists before adding the column
DO $$ BEGIN
    CREATE TYPE queue_scope AS ENUM ('PER_RESOURCE', 'CENTRAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS queue_mode_default queue_scope DEFAULT 'CENTRAL';

-- 2. Appointments missing columns
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(50),
ADD COLUMN IF NOT EXISTS queue_number INTEGER,
ADD COLUMN IF NOT EXISTS token_number VARCHAR(100);

-- 3. Users missing columns
ALTER TABLE users
ADD COLUMN IF NOT EXISTS notification_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS email_notification_enabled BOOLEAN DEFAULT true;
