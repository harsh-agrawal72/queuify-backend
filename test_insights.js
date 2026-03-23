const adminService = require('./src/services/admin.service');
const { pool } = require('./src/config/db');

async function testFix() {
    const orgId = 'd9c026b9-e47c-473d-88b3-31ce0aa33247';
    console.log(`Testing fixes for Org: ${orgId}`);
    
    try {
        console.log('\n--- Testing getLiveQueue ---');
        const queue = await adminService.getLiveQueue(orgId);
        console.log('Live Queue success! Item count:', queue.length);
        if (queue.length > 0) {
            console.log('First queue first appointment name:', queue[0].appointments[0]?.user_name);
        }

        console.log('\n--- Testing getPredictiveInsights ---');
        const insights = await adminService.getPredictiveInsights(orgId);
        console.log('Predictive Insights success!');
        console.log('Keys returned:', Object.keys(insights).join(', '));
        console.log('Current Predictions count:', insights.currentPredictions.length);

    } catch (err) {
        console.error('\nTEST FAILED:', err.message);
        console.error(err.stack);
    } finally {
        await pool.end();
    }
}

testFix();
