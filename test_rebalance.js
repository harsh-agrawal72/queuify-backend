const { pool } = require('./src/config/db');
const reassignmentService = require('./src/services/reassignment.service');

async function testRebalance() {
    try {
        console.log('--- Testing Rebalance Logic ---');
        
        // 1. Find a resource with appointments today
        const today = new Date().toISOString().split('T')[0];
        const resWithAppts = await pool.query(`
            SELECT resource_id, COUNT(*) as count 
            FROM appointments 
            WHERE preferred_date = $1::date
            GROUP BY resource_id
            HAVING COUNT(*) > 0
            LIMIT 1
        `, [today]);

        if (resWithAppts.rows.length === 0) {
            console.log('No resources with appointments found for today. Please create some test data.');
            return;
        }

        const resourceId = resWithAppts.rows[0].resource_id;
        console.log(`Testing with Resource: ${resourceId}, Found ${resWithAppts.rows[0].count} appts`);

        // 2. Trigger rebalance
        console.log(`Running rebalanceResourceSlots for ${resourceId} on ${today}...`);
        const result = await reassignmentService.rebalanceResourceSlots(resourceId, today);
        
        console.log('Rebalance Result:', result);
        
        if (result.movedCount >= 0) {
            console.log('SUCCESS: Rebalance function executed and returned counts.');
        } else {
            console.log('FAILURE: Rebalance returned unexpected result.');
        }

    } catch (err) {
        console.error('TEST FAILED:', err);
    } finally {
        await pool.end();
    }
}

testRebalance();
