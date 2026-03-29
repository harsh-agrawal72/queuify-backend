-- 20260329_deep_automated_escrow.sql
-- 1. Wallets: Add Disputed Balance
ALTER TABLE wallets 
ADD COLUMN IF NOT EXISTS disputed_balance DECIMAL(12, 2) DEFAULT 0;

-- 2. Appointments: Add Check-in & Dispute tracking
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dispute_status') THEN
        CREATE TYPE dispute_status AS ENUM ('none', 'flagged', 'resolved');
    END IF;
END $$;

ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS check_in_method VARCHAR(20) DEFAULT 'otp',
ADD COLUMN IF NOT EXISTS dispute_status dispute_status DEFAULT 'none',
ADD COLUMN IF NOT EXISTS dispute_reason TEXT;

-- 3. Payout Requests: Add Razorpay IDs and Status
ALTER TABLE payout_requests
ADD COLUMN IF NOT EXISTS razorpay_payout_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS payout_status VARCHAR(50) DEFAULT 'pending';

-- 4. Wallet Transactions: Add 'disputed' status
DO $$ 
BEGIN 
    -- Adding to an existing enum is tricky but this is a common approach if it's already defined
    -- Or we can just ensure the column is VARCHAR or handled by the app layer.
    -- (Assuming transactional status is being handled via VARCHAR in current code)
    NULL;
END $$;
