/**
 * autoRefund.service.js — Tiered Auto-Refund Engine
 *
 * Determines the refund amount based on cancellation timing:
 *
 *   ┌───────────────────────────────────────────────────────┐
 *   │  Time before slot start  │  Refund %  │  Reason       │
 *   ├──────────────────────────┼────────────┼───────────────┤
 *   │  > 24 hours              │  100%      │  Full refund  │
 *   │  4 – 24 hours            │  75%       │  Partial      │
 *   │  1 – 4 hours             │  50%       │  Late cancel  │
 *   │  < 1 hour                │  0%        │  No refund    │
 *   └───────────────────────────────────────────────────────┘
 *
 *   Admin cancellations ALWAYS give 100% refund + ₹20 penalty
 *   (penalty is applied separately by settlement cron).
 */

const { pool } = require('../config/db');
const walletService = require('./wallet.service');
const razorpayService = require('./razorpay.service');
const ApiError = require('../utils/ApiError');
const httpStatus = require('../utils/httpStatus');

/**
 * Calculate refund percentage based on cancellation timing
 * @param {Date} slotStartTime - When the appointment was scheduled to start
 * @param {string} cancelledBy - 'user' | 'admin'
 * @returns {{ percentage: number, label: string }}
 */
const getRefundPolicy = (slotStartTime, cancelledBy) => {
    if (cancelledBy === 'admin') {
        return { percentage: 100, label: 'Full refund (Admin cancellation)' };
    }

    const now = new Date();
    const hoursUntilSlot = (new Date(slotStartTime) - now) / (1000 * 60 * 60);

    if (hoursUntilSlot >= 24) {
        return { percentage: 100, label: 'Full refund (>24h notice)' };
    } else if (hoursUntilSlot >= 4) {
        return { percentage: 70, label: '70% refund (4–24h notice)' };
    } else {
        return { percentage: 0, label: 'No refund (<4h notice)' };
    }
};

/**
 * Process automatic refund when an appointment is cancelled
 * 
 * @param {string} appointmentId 
 * @param {string} cancelledBy - 'user' | 'admin'
 */
const processRefund = async (appointmentId, cancelledBy) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Fetch appointment details
        const apptRes = await client.query(
            `SELECT a.id, a.org_id, a.user_id, a.price, a.payment_status, a.status, a.payment_id,
                    s.start_time
             FROM appointments a
             LEFT JOIN slots s ON a.slot_id = s.id
             WHERE a.id = $1`,
            [appointmentId]
        );

        const appt = apptRes.rows[0];
        if (!appt) {
            await client.query('ROLLBACK');
            return { refunded: false, reason: 'Appointment not found' };
        }

        // 2. Only process if this was a paid appointment
        if (appt.payment_status !== 'paid' || parseFloat(appt.price) <= 0) {
            await client.query('ROLLBACK');
            return { refunded: false, reason: 'No payment to refund' };
        }

        // 3. Verify there's actually a locked transaction to refund
        const lockedTxRes = await client.query(
            `SELECT id, amount FROM wallet_transactions
             WHERE reference_id::text = $1 AND type = 'credit' AND status = 'locked'
             LIMIT 1`,
            [appointmentId]
        );

        if (lockedTxRes.rows.length === 0) {
            // Check if funds were already released (completed case) — refund from available
            const availableTxRes = await client.query(
                `SELECT id, amount FROM wallet_transactions
                 WHERE reference_id::text = $1 AND type = 'credit' AND status = 'available'
                 LIMIT 1`,
                [appointmentId]
            );
            if (availableTxRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return { refunded: false, reason: 'No locked or available funds found for this appointment' };
            }
        }

        // 4. Calculate refund amount
        const policy = getRefundPolicy(appt.start_time, cancelledBy);
        const originalAmount = parseFloat(appt.price);
        const refundAmount = parseFloat(((policy.percentage / 100) * originalAmount).toFixed(2));

        if (refundAmount <= 0) {
            // Mark locked funds as forfeited (moved to available for org)
            await client.query(
                `UPDATE wallet_transactions SET status = 'available', description = description || ' (Forfeited - late cancellation)'
                 WHERE reference_id::text = $1 AND type = 'credit' AND status = 'locked'`,
                [appointmentId]
            );
            await client.query(
                `UPDATE wallets SET
                    locked_funds = GREATEST(locked_funds - $1, 0),
                    available_balance = available_balance + $1
                 WHERE org_id = $2`,
                [originalAmount, appt.org_id]
            );
            await client.query('COMMIT');
            return {
                refunded: false,
                forfeited: true,
                amount: 0,
                policy: policy.label,
                reason: 'Late cancellation — no refund issued, funds forfeited to organization'
            };
        }

        // 6. Trigger External Razorpay Refund
        let razorpayRefundId = null;
        let refundSuccessful = true;
        
        if (refundAmount > 0 && appt.payment_id) {
            try {
                console.log(`[AutoRefund] Triggering actual Razorpay refund for appt=${appointmentId}, payment=${appt.payment_id}`);
                const rzpRefund = await razorpayService.refundPayment(appt.payment_id, refundAmount, {
                    appointment_id: appointmentId,
                    reason: policy.label
                });
                razorpayRefundId = rzpRefund.id;
                console.log(`[AutoRefund] Razorpay API success: ${razorpayRefundId}`);
            } catch (rzpErr) {
                console.error(`[AutoRefund] Razorpay API refund FAILED for appt=${appointmentId}:`, rzpErr.message);
                refundSuccessful = false;
            }
        }

        // 7. Finalize status based on refund success
        const finalPaymentStatus = refundSuccessful ? 'refunded' : 'refund_failed';
        
        const updateApptRes = await client.query(
            `UPDATE appointments 
             SET status = 'cancelled', 
                 payment_status = $1, 
                 refund_amount = $2, 
                 razorpay_refund_id = $3,
                 updated_at = NOW() 
             WHERE id = $4 
             RETURNING status, payment_status`,
            [finalPaymentStatus, refundAmount, razorpayRefundId, appointmentId]
        );

        if (updateApptRes.rowCount > 0) {
            console.log(`[AutoRefund] Appointment updated to: ${finalPaymentStatus}`);
        }

        // 8. Wallet finalize
        if (refundSuccessful) {
            const walletRes = await client.query('SELECT id FROM wallets WHERE org_id = $1', [appt.org_id]);
            if (walletRes.rows.length > 0) {
                const walletId = walletRes.rows[0].id;
                // Deduct from locked funds (the refunded portion)
                await client.query(
                    'UPDATE wallets SET locked_funds = GREATEST(locked_funds - $1, 0), total_earned = GREATEST(total_earned - $1, 0) WHERE id = $2',
                    [refundAmount, walletId]
                );
                // If partial refund, the remainder becomes available
                const remainder = originalAmount - refundAmount;
                if (remainder > 0) {
                    await client.query(
                        'UPDATE wallets SET locked_funds = GREATEST(locked_funds - $1, 0), available_balance = available_balance + $1 WHERE id = $2',
                        [remainder, walletId]
                    );
                }
                // Update the original locked transaction
                await client.query(
                    `UPDATE wallet_transactions SET status = 'cancelled', description = description || $1
                     WHERE reference_id::text = $2 AND type = 'credit' AND status = 'locked'`,
                    [` — ${policy.label}`, appointmentId]
                );
                // Log the refund transaction
                await client.query(
                    `INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description)
                     VALUES ($1, $2, 'refund', 'completed', $3, $4)`,
                    [walletId, -refundAmount, appointmentId, `Refund: ${policy.label} for appointment ${appointmentId}`]
                );
            }
        } else {
            // Handle failed external refund internal state (Keep funds locked or mark as problem)
            await client.query(
                `UPDATE wallet_transactions 
                 SET description = description || ' (Auto-refund failed: Manual action required)'
                 WHERE reference_id::text = $1 AND type = 'credit' AND status = 'locked'`,
                [appointmentId]
            );
        }

        await client.query('COMMIT');

        // 9. Real-time update via Socket
        try {
            const socket = require('../socket/index');
            socket.emitQueueUpdate({
                orgId: appt.org_id,
                userId: appt.user_id
            }, {
                type: 'status_update',
                appointmentId,
                status: 'cancelled',
                cancelled_by: cancelledBy,
                payment_status: finalPaymentStatus
            });
        } catch (socketErr) {
            console.error('[AutoRefund] Socket update failed:', socketErr.message);
        }

        console.log(`[AutoRefund] Processed: appt=${appointmentId}, amount=₹${refundAmount}, policy="${policy.label}"`);

        return {
            refunded: refundSuccessful,
            amount: refundAmount,
            percentage: policy.percentage,
            policy: policy.label,
            originalAmount
        };

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[AutoRefund] Error for appointment ${appointmentId}:`, err.message);
        throw err;
    } finally {
        client.release();
    }
};

/**
 * Get the refund policy preview for an appointment (for displaying in UI before cancellation)
 */
const getRefundPreview = async (appointmentId, cancelledBy = 'user') => {
    const apptRes = await pool.query(
        `SELECT a.price, a.payment_status, s.start_time
         FROM appointments a
         LEFT JOIN slots s ON a.slot_id = s.id
         WHERE a.id = $1`,
        [appointmentId]
    );

    if (!apptRes.rows[0]) throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');

    const appt = apptRes.rows[0];
    if (appt.payment_status !== 'paid' || parseFloat(appt.price) <= 0) {
        return { hasPaidAmount: false };
    }

    const policy = getRefundPolicy(appt.start_time, cancelledBy);
    const originalAmount = parseFloat(appt.price);
    const refundAmount = parseFloat(((policy.percentage / 100) * originalAmount).toFixed(2));

    return {
        hasPaidAmount: true,
        originalAmount,
        refundAmount,
        percentage: policy.percentage,
        policy: policy.label
    };
};

module.exports = { processRefund, getRefundPolicy, getRefundPreview };
