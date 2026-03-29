-- 20260330_fix_appointment_enum.sql
-- Safely add 'pending_payment' to the appointment_status enum type
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_type t 
        JOIN pg_enum e ON t.oid = e.enumtypid 
        WHERE t.typname = 'appointment_status' AND e.enumlabel = 'pending_payment'
    ) THEN
        ALTER TYPE appointment_status ADD VALUE 'pending_payment';
    END IF;
END $$;
