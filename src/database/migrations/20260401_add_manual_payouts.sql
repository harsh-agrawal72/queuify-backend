-- ═══════════════════════════════════════
-- MANUAL PAYOUTS SCHEMA
-- ═══════════════════════════════════════

-- 1. Create payout_requests table
CREATE TABLE IF NOT EXISTS payout_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    amount DECIMAL(12, 2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'completed', 'rejected'
    bank_details JSONB, -- Snapshot of bank details at time of request
    reason TEXT, -- Rejection reason
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Add manual payout columns to wallets table
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wallets' AND column_name = 'bank_details') THEN
        ALTER TABLE wallets ADD COLUMN bank_details JSONB;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wallets' AND column_name = 'fund_account_id') THEN
        ALTER TABLE wallets ADD COLUMN fund_account_id VARCHAR(255);
    END IF;
END $$;

-- 3. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_payout_requests_wallet_id ON payout_requests(wallet_id);
CREATE INDEX IF NOT EXISTS idx_payout_requests_status ON payout_requests(status);
