// backend/src/database/update-user-plan-prices.js
const { pool } = require('../config/db');

const updatePrices = async () => {
    console.log('--- Updating User Plan Prices in Database ---');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Update Standard Plan
        await client.query(
            "UPDATE plans SET price_monthly = 49, price_yearly = 490 WHERE name = 'Standard' AND target_role = 'user'"
        );
        console.log('Updated Standard plan price to 49');

        // Update Premium Plan
        await client.query(
            "UPDATE plans SET price_monthly = 149, price_yearly = 1490 WHERE name = 'Premium' AND target_role = 'user'"
        );
        console.log('Updated Premium plan price to 149');

        await client.query('COMMIT');
        console.log('--- Database Updates Successful ---');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('--- Database Update Failed ---');
        console.error(err.message);
    } finally {
        client.release();
        process.exit(0);
    }
};

updatePrices();
