-- 20260329_add_org_payout_details.sql
-- Add payout-related bank and UPI details to the organizations table

ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS payout_bank_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS payout_account_holder VARCHAR(150),
ADD COLUMN IF NOT EXISTS payout_account_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS payout_ifsc VARCHAR(20),
ADD COLUMN IF NOT EXISTS payout_upi_id VARCHAR(100);
