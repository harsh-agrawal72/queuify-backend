-- 20260330_add_otp_column.sql
-- Add the missing 4-digit OTP code column to the appointments table for check-in verification

ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS otp_code VARCHAR(4);

-- Optional: Initialize existing appointments with a random code (if needed)
UPDATE appointments SET otp_code = LPAD(floor(random() * 10000)::text, 4, '0') 
WHERE otp_code IS NULL;
