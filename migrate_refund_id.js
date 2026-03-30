const { pool } = require('./src/config/db');

async function migrate() {
    try {
        console.log('[Migration] Adding razorpay_refund_id to appointments table...');
        await pool.query(`
            ALTER TABLE appointments 
            ADD COLUMN IF NOT EXISTS razorpay_refund_id character varying(255)
        `);
        console.log('[Migration] Migration successful.');
        process.exit(0);
    } catch (e) {
        console.error('[Migration] Migration failed:', e.message);
        process.exit(1);
    }
}

migrate();
