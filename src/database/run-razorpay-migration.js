// backend/src/database/run-razorpay-migration.js
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

const runMigration = async () => {
    const migrationPath = path.join(__dirname, 'migrations', '20260412_add_razorpay_order_id.sql');
    
    // We can also just run the raw SQL here instead of reading the file just in case
    const sql = `
        ALTER TABLE appointments 
        ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(255);
        
        CREATE INDEX IF NOT EXISTS idx_appointments_rzp_order_id 
        ON appointments(razorpay_order_id);
    `;

    console.log('--- Starting Razorpay Order ID Migration ---');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
        console.log('--- Migration Completed Successfully ---');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('--- Migration Failed ---');
        console.error(err.message);
        process.exit(1);
    } finally {
        client.release();
        process.exit(0);
    }
};

runMigration();
