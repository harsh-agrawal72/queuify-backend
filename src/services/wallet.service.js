// backend/src/services/wallet.service.js
const { pool } = require('../config/db');
const ApiError = require('../utils/ApiError');
const httpStatus = require('../utils/httpStatus');

/**
 * Initialize a wallet for an organization
 */
const initWallet = async (orgId) => {
    const res = await pool.query(
        'INSERT INTO wallets (org_id) VALUES ($1) ON CONFLICT (org_id) DO UPDATE SET updated_at = NOW() RETURNING *',
        [orgId]
    );
    return res.rows[0];
};

/**
 * Get wallet by Org ID
 */
const getWalletByOrgId = async (orgId) => {
    const res = await pool.query('SELECT * FROM wallets WHERE org_id = $1', [orgId]);
    if (res.rows.length === 0) {
        return await initWallet(orgId);
    }
    return res.rows[0];
};

/**
 * Credit funds to a wallet (Locked state)
 * Used when a user pays for an appointment
 */
const creditLockedFunds = async (orgId, amount, appointmentId, description = 'Appointment Booking') => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const wallet = await getWalletByOrgId(orgId);
        
        // 1. Update wallet's locked funds
        await client.query(
            'UPDATE wallets SET locked_funds = locked_funds + $1, total_earned = total_earned + $1 WHERE id = $2',
            [amount, wallet.id]
        );

        // 2. Create ledger entry
        await client.query(
            'INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description) VALUES ($1, $2, $3, $4, $5, $6)',
            [wallet.id, amount, 'credit', 'locked', appointmentId, description]
        );

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('[WalletService] Credit failed:', e.message);
        throw e;
    } finally {
        client.release();
    }
};

/**
 * Release locked funds to available balance
 * Used after midnight cron or manual verification
 */
const releaseFunds = async (orgId, appointmentId, externalClient = null) => {
    const client = externalClient || await pool.connect();
    const manageTransaction = !externalClient;
    try {
        if (manageTransaction) await client.query('BEGIN');

        // 1. Find the locked transaction
        const txRes = await client.query(
            "SELECT * FROM wallet_transactions WHERE reference_id = $1 AND type = 'credit' AND status = 'locked' FOR UPDATE",
            [appointmentId]
        );
        if (txRes.rows.length === 0) {
            console.log(`[WalletService] No locked funds for Appointment ${appointmentId}`);
            if (manageTransaction) await client.query('COMMIT');
            return;
        }

        const tx = txRes.rows[0];
        const { wallet_id, amount } = tx;

        // 2. Update wallet: locked -> available
        await client.query(
            'UPDATE wallets SET locked_funds = GREATEST(locked_funds - $1, 0), available_balance = available_balance + $1 WHERE id = $2',
            [amount, wallet_id]
        );

        // 3. Update transaction status
        await client.query(
            "UPDATE wallet_transactions SET status = 'available' WHERE id = $1",
            [tx.id]
        );

        if (manageTransaction) await client.query('COMMIT');
        return true;
    } catch (e) {
        if (manageTransaction) await client.query('ROLLBACK');
        console.error('[WalletService] Release failed:', e.message);
        throw e;
    } finally {
        if (manageTransaction) client.release();
    }
};

/**
 * Debit/Refund funds (Remove from locked or available)
 */
const refundFunds = async (orgId, appointmentId, amount, isFullRefund = true) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const wallet = await getWalletByOrgId(orgId);
        
        // 1. Find if funds are locked or available
        const txRes = await client.query(
            "SELECT * FROM wallet_transactions WHERE reference_id = $1 AND type = 'credit' ORDER BY created_at DESC LIMIT 1",
            [appointmentId]
        );
        
        if (txRes.rows.length === 0) {
            await client.query('COMMIT');
            return; // No funds to refund
        }

        const tx = txRes.rows[0];

        if (tx.status === 'locked') {
            await client.query(
                'UPDATE wallets SET locked_funds = GREATEST(locked_funds - $1, 0), total_earned = GREATEST(total_earned - $1, 0) WHERE id = $2',
                [amount, wallet.id]
            );
        } else if (tx.status === 'available') {
            await client.query(
                'UPDATE wallets SET available_balance = GREATEST(available_balance - $1, 0), total_earned = GREATEST(total_earned - $1, 0) WHERE id = $2',
                [amount, wallet.id]
            );
        }

        // 2. Add refund entry to ledger
        await client.query(
            'INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description) VALUES ($1, $2, $3, $4, $5, $6)',
            [wallet.id, -amount, 'refund', 'completed', appointmentId, `Refund for Appointment ${appointmentId}`]
        );

        // 3. Update original transaction status if it was locked
        if (tx.status === 'locked') {
            await client.query("UPDATE wallet_transactions SET status = 'cancelled' WHERE id = $1", [tx.id]);
        }

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('[WalletService] Refund failed:', e.message);
        throw e;
    } finally {
        client.release();
    }
};

/**
 * Handle Payout Request
 */
const requestPayout = async (orgId, amount, bankDetails) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const wallet = await getWalletByOrgId(orgId);
        if (wallet.available_balance < amount) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Insufficient available balance for payout');
        }

        // 1. Deduct from wallet balance
        await client.query(
            'UPDATE wallets SET available_balance = available_balance - $1 WHERE id = $2',
            [amount, wallet.id]
        );

        // 2. Create payout request
        const payoutRes = await client.query(
            'INSERT INTO payout_requests (wallet_id, amount, status, bank_details) VALUES ($1, $2, $3, $4) RETURNING id',
            [wallet.id, amount, 'pending', JSON.stringify(bankDetails)]
        );

        // 3. Create debit entry in ledger
        await client.query(
            'INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description) VALUES ($1, $2, $3, $4, $5, $6)',
            [wallet.id, -amount, 'payout', 'completed', payoutRes.rows[0].id, 'Manual Withdrawal Request']
        );

        await client.query('COMMIT');
        return payoutRes.rows[0].id;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

/**
 * Hold funds in a disputed state
 * Moves from locked_funds to disputed_balance
 */
const holdFundsForDispute = async (orgId, appointmentId, reason) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const wallet = await getWalletByOrgId(orgId);

        // 1. Find the locked transaction
        const txRes = await client.query(
            "SELECT * FROM wallet_transactions WHERE reference_id = $1 AND type = 'credit' AND status = 'locked' FOR UPDATE",
            [appointmentId]
        );
        if (txRes.rows.length === 0) {
            throw new ApiError(httpStatus.NOT_FOUND, 'No locked funds found for this appointment');
        }
        const tx = txRes.rows[0];

        // 2. Update wallet: locked -> disputed
        await client.query(
            'UPDATE wallets SET locked_funds = GREATEST(locked_funds - $1, 0), disputed_balance = disputed_balance + $1 WHERE id = $2',
            [tx.amount, wallet.id]
        );

        // 3. Update transaction status
        await client.query(
            "UPDATE wallet_transactions SET status = 'disputed', description = description || $1 WHERE id = $2",
            [` — Disputed: ${reason}`, tx.id]
        );

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

/**
 * Resolve a dispute
 * @param {string} decision - 'release' (to admin) | 'refund' (to user)
 */
const resolveDispute = async (orgId, appointmentId, decision) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const wallet = await getWalletByOrgId(orgId);

        // 1. Find the disputed transaction
        const txRes = await client.query(
            "SELECT * FROM wallet_transactions WHERE reference_id = $1 AND type = 'credit' AND status = 'disputed' FOR UPDATE",
            [appointmentId]
        );
        if (txRes.rows.length === 0) {
            throw new ApiError(httpStatus.NOT_FOUND, 'No disputed funds found for this appointment');
        }
        const tx = txRes.rows[0];

        if (decision === 'release') {
            // Move to available
            await client.query(
                'UPDATE wallets SET disputed_balance = GREATEST(disputed_balance - $1, 0), available_balance = available_balance + $1 WHERE id = $2',
                [tx.amount, wallet.id]
            );
            await client.query("UPDATE wallet_transactions SET status = 'available' WHERE id = $1", [tx.id]);
        } else {
            // Refund to user (simulated)
            await client.query(
                'UPDATE wallets SET disputed_balance = GREATEST(disputed_balance - $1, 0), total_earned = GREATEST(total_earned - $1, 0) WHERE id = $2',
                [tx.amount, wallet.id]
            );
            await client.query("UPDATE wallet_transactions SET status = 'cancelled' WHERE id = $1", [tx.id]);
            await client.query(
                'INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description) VALUES ($1, $2, $3, $4, $5, $6)',
                [wallet.id, -tx.amount, 'refund', 'completed', appointmentId, `Dispute Resolved: Refunded to User`]
            );
        }

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

/**
 * Get Transaction History for an organization
 */
const getTransactionHistory = async (orgId, limit = 50, offset = 0) => {
    const wallet = await getWalletByOrgId(orgId);
    const res = await pool.query(
        'SELECT * FROM wallet_transactions WHERE wallet_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [wallet.id, limit, offset]
    );
    
    const countRes = await pool.query('SELECT COUNT(*) FROM wallet_transactions WHERE wallet_id = $1', [wallet.id]);
    
    return {
        transactions: res.rows,
        total: parseInt(countRes.rows[0].count),
        limit,
        offset
    };
};

module.exports = {
    initWallet,
    getWalletByOrgId,
    creditLockedFunds,
    releaseFunds,
    refundFunds,
    requestPayout,
    holdFundsForDispute,
    resolveDispute,
    getTransactionHistory
};
