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
            [wallet.id, amount, 'processing', wallet.bank_details]
        );
        const payoutRequestId = payoutReqRes.rows[0].id;

        // 3. Deduct from available balance immediately to prevent double-spend
        await client.query(
            'UPDATE wallets SET balance = balance - $1 WHERE id = $2',
            [amount, wallet.id]
        );

        // 4. Trigger External Payout (API Call)
        // Note: In real scenarios, this might be async via webhooks, but here we simulate success.
        const rzpPayout = await razorpayMock.payouts.create({
            account_number: '7878780080316316', // Platform merchant account
            fund_account_id: wallet.fund_account_id,
            amount: Math.round(amount * 100), // convert to paise
            currency: 'INR',
            mode: 'IMPS',
            purpose: 'payout',
            reference_id: `REQ_${payoutRequestId}`
        });

        // 5. Update local record with Razorpay ID
        await client.query(
            "UPDATE payout_requests SET razorpay_payout_id = $1, payout_status = 'processed', status = 'completed' WHERE id = $2",
            [rzpPayout.id, payoutRequestId]
        );

        // 6. Finalize Ledger Entry
        await client.query(
            'INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description) VALUES ($1, $2, $3, $4, $5, $6)',
            [wallet.id, -amount, 'payout', 'completed', payoutRequestId, `Bank Withdrawal: ${rzpPayout.id}`]
        );

        await client.query('COMMIT');
        return { success: true, payoutId: rzpPayout.id, amount };

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('[PayoutService] Withdrawal Failed:', e.message);
        throw e;
    } finally {
        client.release();
    }
};

module.exports = {
    linkBankAccount,
    withdrawToBank
};
