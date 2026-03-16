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
ADD COLUMN IF NOT EXISTS token_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS is_deleted_permanent BOOLEAN DEFAULT FALSE;

-- 3. Users missing columns
ALTER TABLE users
ADD COLUMN IF NOT EXISTS notification_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS email_notification_enabled BOOLEAN DEFAULT true;

-- 4. Organization Profile missing columns
ALTER TABLE organization_profiles
ADD COLUMN IF NOT EXISTS city VARCHAR(100),
ADD COLUMN IF NOT EXISTS state VARCHAR(100),
ADD COLUMN IF NOT EXISTS pincode VARCHAR(20),
ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50),
ADD COLUMN IF NOT EXISTS website_url VARCHAR(255),
ADD COLUMN IF NOT EXISTS working_hours JSONB,
ADD COLUMN IF NOT EXISTS gst_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS registration_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS established_year INTEGER,
ADD COLUMN IF NOT EXISTS total_staff INTEGER,
ADD COLUMN IF NOT EXISTS facebook_url VARCHAR(255),
ADD COLUMN IF NOT EXISTS instagram_url VARCHAR(255),
ADD COLUMN IF NOT EXISTS linkedin_url VARCHAR(255),
ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false;

-- 5. Organization Images binary data support
ALTER TABLE organization_images 
ADD COLUMN IF NOT EXISTS image_data BYTEA,
ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100);

ALTER TABLE organization_images 
ALTER COLUMN image_url DROP NOT NULL;


