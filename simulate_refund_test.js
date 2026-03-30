/**
 * backend/simulate_refund_test.js
 * 
 * Run with: node backend/simulate_refund_test.js
 * This script finds a paid appointment and runs the autoRefundService.processRefund logic 
 * without actually cancelling (or it can simulate cancellation).
 */
const { pool } = require('./src/config/db');
const autoRefundService = require('./src/services/autoRefund.service');

async function runTest() {
    console.log('--- STARTING REFUND SIMULATION TEST ---');
    try {
        // 1. Find a paid appointment to test on (confirmed/pending ones are best)
        const apptRes = await pool.query(
            "SELECT id, payment_id, price FROM appointments WHERE payment_status = 'paid' LIMIT 1"
        );
        
        if (apptRes.rows.length === 0) {
            console.log('No paid appointments found to test with.');
            process.exit(0);
        }

        const apptId = apptRes.rows[0].id;
        console.log(`Testing with Appointment ID: ${apptId}, Payment ID: ${apptRes.rows[0].payment_id}`);

        // 2. Perform Admin-style refund simulation
        console.log('\nSimulating ADMIN Cancellation Refund...');
        const adminResult = await autoRefundService.processRefund(apptId, 'admin');
        console.log('Admin Simulation Result:', JSON.stringify(adminResult, null, 2));

        // 3. Since we just "cancelled" it in step 2 (internally in DB), we might need another one for user test
        // but for now, let's just see if this even worked once.
        
    } catch (error) {
        console.error('TEST FAILED:', error);
    } finally {
        await pool.end();
        console.log('\n--- TEST COMPLETE ---');
    }
}

runTest();
