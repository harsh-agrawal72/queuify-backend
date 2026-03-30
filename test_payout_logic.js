/**
 * backend/test_payout_logic.js
 */
const { pool } = require('./src/config/db');
const walletService = require('./src/services/wallet.service');

async function test() {
    console.log('--- TESTING PAYOUT LOGIC (₹500 MIN) ---');
    try {
        // 1. Get an org
        const orgRes = await pool.query("SELECT id FROM organizations LIMIT 1");
        const orgId = orgRes.rows[0].id;

        // 2. Add some balance (₹1000)
        console.log('Adding ₹1000 to available balance...');
        await pool.query("UPDATE wallets SET available_balance = 1000 WHERE org_id = $1", [orgId]);

        // 3. Try ₹400 (Should fail)
        console.log('\nScenario 1: Testing ₹400 payout (should fail)...');
        try {
            await walletService.requestPayout(orgId, 400, { bank: 'test' });
        } catch (e) {
            console.log('Expected error caught:', e.message);
        }

        // 4. Try ₹600 (Should succeed & be 'completed')
        console.log('\nScenario 2: Testing ₹600 payout (should succeed instantly)...');
        const payoutId = await walletService.requestPayout(orgId, 600, { bank: 'test' });
        console.log('Payout triggered ID:', payoutId);

        const checkRes = await pool.query("SELECT status FROM payout_requests WHERE id = $1", [payoutId]);
        console.log('Final Status in DB:', checkRes.rows[0].status); // Should be 'completed'

    } catch (e) {
        console.error('Test failed:', e);
    } finally {
        await pool.end();
    }
}
test();
