const { rebalanceResourceSlots } = require('./src/services/reassignment.service');
const { pool } = require('./src/config/db');

async function testManualRebalance() {
    try {
        const resourceId = '77ea86d5-fe8d7a'; // Extracted from DB
        const testDate = '2026-03-30';

        console.log(`\n>>> STARTING TARGETED MANUAL REBALANCE TEST <<<`);
        console.log(`Resource ID: ${resourceId}`);
        console.log(`Date: ${testDate}`);

        const result = await rebalanceResourceSlots(resourceId, testDate);
        console.log(`\nRESULT:`, JSON.stringify(result, null, 2));

    } catch (err) {
        console.error('TEST FAILED:', err);
    } finally {
        await pool.end();
    }
}

testManualRebalance();
