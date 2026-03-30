/**
 * backend/simulate_refund_test.js
 */
const { pool } = require('./src/config/db');
const autoRefundService = require('./src/services/autoRefund.service');

async function runTest() {
    console.log('--- STARTING 6-HOUR RULE REFUND SIMULATION ---');
    try {
        // 1. Find appointments created by force_test_appointment.js
        const apptResFar = await pool.query("SELECT id FROM appointments WHERE payment_id = 'pay_test_far_future' LIMIT 1");
        const apptResNear = await pool.query("SELECT id FROM appointments WHERE payment_id = 'pay_test_near_future' LIMIT 1");

        if (apptResFar.rows.length === 0 || apptResNear.rows.length === 0) {
            console.log('No test appointments found. Please run force_test_appointment.js first.');
            return;
        }

        const farId = apptResFar.rows[0].id;
        const nearId = apptResNear.rows[0].id;

        // Test Scenario 1: User cancel > 6 hours away
        console.log('\n--- Scenario 1: User Cancel > 6 Hours notice ---');
        const res1 = await autoRefundService.processRefund(farId, 'user');
        console.log('Result 1:', JSON.stringify(res1, null, 2));

        // Test Scenario 2: User cancel < 6 hours away
        console.log('\n--- Scenario 2: User Cancel < 6 Hours notice ---');
        const res2 = await autoRefundService.processRefund(nearId, 'user');
        console.log('Result 2:', JSON.stringify(res2, null, 2));

        // Test Scenario 3: Admin cancel (always 100%)
        console.log('\n--- Scenario 3: Admin Cancel (Anytime) ---');
        const res3 = await autoRefundService.processRefund(nearId, 'admin'); 
        // Note: nearId is already cancelled now, but processRefund will try anyway.
        console.log('Result 3:', JSON.stringify(res3, null, 2));

    } catch (error) {
        console.error('TEST FAILED:', error);
    } finally {
        await pool.end();
        console.log('\n--- TEST COMPLETE ---');
    }
}
runTest();
