/**
 * backend/prep_test_data.js
 */
const { pool } = require('./src/config/db');

async function prep() {
    try {
        console.log('Prepping test data...');
        // 1. Get a paid appointment
        const apptRes = await pool.query("SELECT id, org_id, price FROM appointments WHERE payment_status = 'paid' LIMIT 1");
        if (apptRes.rows.length === 0) {
            console.log('No paid appt found. Please pay for one in UI first.');
            return;
        }
        const appt = apptRes.rows[0];
        console.log(`Prepping appt ${appt.id} for org ${appt.org_id}`);

        // 2. Ensure wallet exists
        await pool.query("INSERT INTO wallets (org_id, locked_funds) VALUES ($1, $2) ON CONFLICT (org_id) DO UPDATE SET locked_funds = wallets.locked_funds + $2", [appt.org_id, appt.price]);
        const walletRes = await pool.query("SELECT id FROM wallets WHERE org_id = $1", [appt.org_id]);
        const walletId = walletRes.rows[0].id;

        // 3. Ensure a 'locked' credit transaction exists in wallet_transactions
        await pool.query("DELETE FROM wallet_transactions WHERE reference_id = $1", [appt.id]);
        await pool.query(
            "INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description) VALUES ($1, $2, $3, $4, $5, $6)",
            [walletId, appt.price, 'credit', 'locked', appt.id, 'Test Credit for Simulation']
        );

        // 4. Ensure it has a dummy payment_id if it's missing (though our check used payment_status='paid')
        // Let's use a real-looking test ID if it's null
        await pool.query("UPDATE appointments SET payment_id = 'pay_test_dummy' WHERE id = $1 AND payment_id IS NULL", [appt.id]);

        console.log('Test data prepped successfully.');
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
prep();
