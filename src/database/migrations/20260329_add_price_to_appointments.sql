-- 20260329_add_price_to_appointments.sql
-- Add price column to appointments table to store the fee at the time of booking
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS price DECIMAL(12, 2) DEFAULT 0;
