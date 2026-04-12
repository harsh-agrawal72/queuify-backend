-- backend/src/database/migrations/20260412_add_razorpay_order_id.sql
-- Add razorpay_order_id column to appointments table

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT;
CREATE INDEX IF NOT EXISTS idx_appointments_razorpay_order_id ON appointments(razorpay_order_id);

-- Also useful to track which order it belongs to for organizations and subscriptions
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT;
