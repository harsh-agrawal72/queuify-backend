/**
 * payout.service.js — Razorpay Payouts (X) Integration
 * 
 * Handles the "Withdraw to Bank" functionality by interfacing with Razorpay's 
 * Payouts API. This enables true "Zero-Human" settlement.
 */

const { pool } = require('../config/db');
const ApiError = require('../utils/ApiError');
const httpStatus = require('../utils/httpStatus');
const walletService = require('./wallet.service');

/**
 * Mock Razorpay Payouts Integration
 * In production, this would use the razorpay-node SDK with Payouts enabled.
 */
const razorpayMock = {
    payouts: {
        create: async (data) => {
            console.log('[Razorpay-Mock] Processing Payout:', data);
            // Simulate API delay
            await new Promise(resolve => setTimeout(resolve, 1000));
            return {
                id: `pout_${Math.random().toString(36).substring(2, 12)}`,
                entity: 'payout',
                fund_account_id: data.fund_account_id,
                amount: data.amount,
                currency: data.currency,
                status: 'processed',
                purpose: data.purpose,
                mode: data.mode,
                reference_id: data.reference_id,
                created_at: Math.floor(Date.now() / 1000)
            };
        }
    }
};

/**
 * Link a bank account (Conceptual Fund Account creation)
 */
const linkBankAccount = async (orgId, bankDetails) => {
    // In real Razorpay, we'd call: 
    // 1. Create Contact
    // 2. Create Fund Account (bank_account)
    const fundAccountId = `fa_${Math.random().toString(36).substring(2, 12)}`;
    
    await pool.query(
        'UPDATE wallets SET bank_details = $1, fund_account_id = $2 WHERE org_id = $3',
        [JSON.stringify(bankDetails), fundAccountId, orgId]
    );
    
    return { fundAccountId };
};

/**
 * Execute Payout from Available Balance to Bank
 */
const withdrawToBank = async (orgId, amount) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Check wallet and balance
        const walletRes = await client.query('SELECT * FROM wallets WHERE org_id = $1 FOR UPDATE', [orgId]);
        if (walletRes.rows.length === 0) throw new ApiError(httpStatus.NOT_FOUND, 'Wallet not found');
        const wallet = walletRes.rows[0];

        if (parseFloat(wallet.balance) < amount) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Insufficient available balance');
        }

        if (!wallet.fund_account_id) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'No bank account linked for payouts');
        }

        // 2. Create local payout request entry
        const payoutReqRes = await client.query(
            'INSERT INTO payout_requests (wallet_id, amount, status, bank_details) VALUES ($1, $2, $3, $4) RETURNING id',
            [wallet.id, amount, 'pending', wallet.bank_details]
        );
        const payoutRequestId = payoutReqRes.rows[0].id;

        // 3. Deduct from available balance immediately to reserve the funds
        await client.query(
            'UPDATE wallets SET balance = balance - $1 WHERE id = $2',
            [amount, wallet.id]
        );

        // 4. Finalize Ledger Entry (as pending)
        await client.query(
            'INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description) VALUES ($1, $2, $3, $4, $5, $6)',
            [wallet.id, -amount, 'payout', 'pending', payoutRequestId, `Payout Request Initiated: ${payoutRequestId.slice(0, 8)}`]
        );

        await client.query('COMMIT');
        return { success: true, payoutId: payoutRequestId, amount, status: 'pending' };

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('[PayoutService] Withdrawal Failed:', e.message);
        throw e;
    } finally {
        client.release();
    }
};

/**
 * Complete a manual payout (Superadmin Only)
 */
const completeManualPayout = async (payoutId, superadminId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get payout request
        const res = await client.query('SELECT * FROM payout_requests WHERE id = $1 FOR UPDATE', [payoutId]);
        if (res.rows.length === 0) throw new ApiError(httpStatus.NOT_FOUND, 'Payout request not found');
        const request = res.rows[0];

        if (request.status !== 'pending') {
            throw new ApiError(httpStatus.BAD_REQUEST, `Cannot complete payout in ${request.status} status`);
        }

        // 2. Update payout request status
        await client.query(
            "UPDATE payout_requests SET status = 'completed', processed_at = NOW() WHERE id = $1",
            [payoutId]
        );

        // 3. Update wallet transaction status
        await client.query(
            "UPDATE wallet_transactions SET status = 'completed', description = description || ' (Completed by Superadmin)' WHERE reference_id = $1 AND type = 'payout'",
            [payoutId]
        );

        await client.query('COMMIT');
        return { success: true, message: 'Payout marked as completed' };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

/**
 * Reject a manual payout and refund balance (Superadmin Only)
 */
const rejectManualPayout = async (payoutId, reason, superadminId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get payout request
        const res = await client.query('SELECT * FROM payout_requests WHERE id = $1 FOR UPDATE', [payoutId]);
        if (res.rows.length === 0) throw new ApiError(httpStatus.NOT_FOUND, 'Payout request not found');
        const request = res.rows[0];

        if (request.status !== 'pending') {
            throw new ApiError(httpStatus.BAD_REQUEST, `Cannot reject payout in ${request.status} status`);
        }

        // 2. Refund balance back to wallet
        await client.query(
            'UPDATE wallets SET balance = balance + $1 WHERE id = $2',
            [request.amount, request.wallet_id]
        );

        // 3. Update payout request status
        await client.query(
            "UPDATE payout_requests SET status = 'rejected', processed_at = NOW() WHERE id = $1",
            [payoutId]
        );

        // 4. Update wallet transaction status
        await client.query(
            "UPDATE wallet_transactions SET status = 'failed', description = 'Payout Rejected: ' || $1 WHERE reference_id = $2 AND type = 'payout'",
            [reason || 'Rejected by superadmin', payoutId]
        );

        await client.query('COMMIT');
        return { success: true, message: 'Payout rejected and funds returned' };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

module.exports = {
    linkBankAccount,
    withdrawToBank,
    completeManualPayout,
    rejectManualPayout
};
