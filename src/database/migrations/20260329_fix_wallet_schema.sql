-- 20260329_fix_wallet_schema.sql
-- Fix wallet table column names and add missing columns
ALTER TABLE wallets 
RENAME COLUMN balance TO available_balance;

ALTER TABLE wallets 
ADD COLUMN IF NOT EXISTS disputed_balance DECIMAL(12, 2) DEFAULT 0;

-- Ensure all numeric columns are consistent in precision
ALTER TABLE wallets ALTER COLUMN available_balance TYPE DECIMAL(12, 2);
ALTER TABLE wallets ALTER COLUMN locked_funds TYPE DECIMAL(12, 2);
ALTER TABLE wallets ALTER COLUMN total_earned TYPE DECIMAL(12, 2);
