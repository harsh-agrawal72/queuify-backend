// backend/src/migrations/11-automated-wallet-system.js
const { pool } = require('../config/db');

const migrate = async () => {
    try {
        console.log('Starting migration: Automated Wallet & Payment System (Batch 1)...');

        console.log('Step 1: Updating existing tables (resource_services, appointments)...');
        await pool.query(`
            ALTER TABLE resource_services ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0;

            ALTER TABLE appointments 
            ADD COLUMN IF NOT EXISTS otp_code VARCHAR(4),
            ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'pending',
            ADD COLUMN IF NOT EXISTS payment_id VARCHAR(100),
            ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
        `);

        console.log('Step 2: Creating wallets table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS wallets (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
                balance NUMERIC DEFAULT 0,
                locked_funds NUMERIC DEFAULT 0,
                total_earned NUMERIC DEFAULT 0,
                currency VARCHAR(10) DEFAULT 'INR',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);

        console.log('Step 3: Creating wallet_transactions table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS wallet_transactions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
                amount NUMERIC NOT NULL,
                type VARCHAR(20) NOT NULL,
                status VARCHAR(20) NOT NULL,
                reference_id UUID,
                description TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);

        console.log('Step 4: Creating payout_requests table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS payout_requests (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
                amount NUMERIC NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                bank_details JSONB,
                processed_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);

        console.log('Step 5: Adding triggers...');
        await pool.query(`
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = NOW();
                RETURN NEW;
            END;
            $$ language 'plpgsql';

            DROP TRIGGER IF EXISTS update_wallets_updated_at ON wallets;
            CREATE TRIGGER update_wallets_updated_at
                BEFORE UPDATE ON wallets
                FOR EACH ROW
                EXECUTE FUNCTION update_updated_at_column();
        `);

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed!');
        console.error(error);
        process.exit(1);
    }
};

migrate();
