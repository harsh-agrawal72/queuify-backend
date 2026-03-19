-- Priority-Based Reassignment Schema Changes

-- 1. Add priority and preference columns to appointments
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS pref_resource VARCHAR(20) DEFAULT 'ANY',
ADD COLUMN IF NOT EXISTS pref_time VARCHAR(20) DEFAULT 'FLEXIBLE';

-- 2. Add waitlisted_urgent status to appointment_status enum
DO $$
BEGIN
    BEGIN
        ALTER TYPE appointment_status ADD VALUE 'waitlisted_urgent';
    EXCEPTION
        WHEN duplicate_object THEN null;
    END;
END $$;
