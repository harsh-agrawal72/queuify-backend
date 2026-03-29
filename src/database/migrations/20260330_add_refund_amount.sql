-- 20260330_add_refund_amount.sql
-- Add refund_amount column to the appointments table to accurately track refunds in user history

ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS refund_amount DECIMAL(12, 2) DEFAULT 0;
