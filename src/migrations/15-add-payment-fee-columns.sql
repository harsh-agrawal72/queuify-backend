-- Add payment fee columns to appointments table
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS platform_fee DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS transaction_fee DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_gst DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS total_payable DECIMAL(10, 2) DEFAULT 0;

-- Comment on columns for clarity
COMMENT ON COLUMN appointments.platform_fee IS 'Net platform earning (Queuify)';
COMMENT ON COLUMN appointments.transaction_fee IS 'Razorpay transaction fee (2%)';
COMMENT ON COLUMN appointments.payment_gst IS 'Total GST (18%) on fees';
COMMENT ON COLUMN appointments.total_payable IS 'Final amount paid by the user';
