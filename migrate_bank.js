const { pool } = require('./src/config/db');

async function migrate() {
    console.log('--- STARTING BANK DETAILS MIGRATION ---');
    try {
        await pool.query(`
            ALTER TABLE organizations 
            ADD COLUMN IF NOT EXISTS payout_bank_name VARCHAR(255),
            ADD COLUMN IF NOT EXISTS payout_account_holder VARCHAR(255),
            ADD COLUMN IF NOT EXISTS payout_account_number VARCHAR(255),
            ADD COLUMN IF NOT EXISTS payout_ifsc VARCHAR(50),
            ADD COLUMN IF NOT EXISTS payout_upi_id VARCHAR(255)
        `);
        console.log('Migration successful: Bank detail columns added to organizations table.');
    } catch (error) {
        console.error('Migration failed:', error.message);
    } finally {
        await pool.end();
    }
}

migrate();
