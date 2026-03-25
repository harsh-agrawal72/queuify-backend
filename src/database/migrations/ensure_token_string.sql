-- Migration to ensure token_number is a VARCHAR and handle any legacy INTEGER types.
-- This fixes 500 errors when inserting string tokens like 'WALK-20260325-XYZ'

DO $$ 
BEGIN
    -- Check if token_number is currently an integer and convert it
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'appointments' 
        AND column_name = 'token_number' 
        AND data_type = 'integer'
    ) THEN
        ALTER TABLE appointments ALTER COLUMN token_number TYPE VARCHAR(100);
        RAISE NOTICE 'Converted appointments.token_number from INTEGER to VARCHAR(100)';
    END IF;

    -- If it doesn't exist at all, add it as VARCHAR
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'appointments' 
        AND column_name = 'token_number'
    ) THEN
        ALTER TABLE appointments ADD COLUMN token_number VARCHAR(100);
        RAISE NOTICE 'Added appointments.token_number as VARCHAR(100)';
    END IF;
END $$;
