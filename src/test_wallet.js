// backend/src/test_wallet.js
const { pool } = require('./config/db');
const walletService = require('./services/wallet.service');

const test = async () => {
    try {
        console.log('--- Testing Wallet System (Batch 1) ---');

        // 1. Create a dummy organization
        const orgRes = await pool.query(
            "INSERT INTO organizations (name, slug, contact_email, org_code) VALUES ('Test Org', 'test-org-wallet', 'test@wallet.com', 'TW101') RETURNING id"
        );
        const orgId = orgRes.rows[0].id;
        console.log('Step 1: Created Org:', orgId);

        // 2. Initialize Wallet
        const wallet = await walletService.initWallet(orgId);
        console.log('Step 2: Wallet Initialized:', wallet.id);

        // 3. Credit Locked Funds
        const amount = 500;
        await walletService.creditLockedFunds(orgId, amount, null, 'Test Credit');
        const walletAfterCredit = await walletService.getWalletByOrgId(orgId);
        console.log('Step 3: Wallet after credit (Locked):', walletAfterCredit.locked_funds);

        // 4. Create a dummy transaction for release test
        // Normally this would be an Appointment ID, but we'll use a dummy UUID
        const dummyApptId = '00000000-0000-0000-0000-000000000000';
        await pool.query(
            'INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description) VALUES ($1, $2, $3, $4, $5, $6)',
            [wallet.id, 100, 'credit', 'locked', dummyApptId, 'Test Release Transaction']
        );
        await walletService.releaseFunds(dummyApptId);
        const walletAfterRelease = await walletService.getWalletByOrgId(orgId);
        console.log('Step 4: Wallet after release (Available):', walletAfterRelease.balance);

        console.log('\n--- Cleanup ---');
        await pool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
        console.log('Test completed successfully and cleaned up.');
        process.exit(0);
    } catch (e) {
        console.error('Test failed!');
        console.error(e);
        process.exit(1);
    }
};

test();
