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
 *   Admin cancellations ALWAYS give 100% refund.
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
 * @param {Object} planFeatures - User's plan features
 * @returns {{ percentage: number, label: string }}
 */
const getRefundPolicy = (slotStartTime, cancelledBy, planFeatures = null) => {
    if (cancelledBy === 'admin') {
        return { percentage: 100, label: 'Full refund (Admin cancellation)' };
    }

    const now = new Date();
    const slotStart = new Date(slotStartTime);

    // Ensure both are compared in the same numeric space (total milliseconds from epoch)
    const diffMs = slotStart.getTime() - now.getTime();
    const hoursUntilSlot = diffMs / (1000 * 60 * 60);

    console.log(`[RefundPolicy] Calculation: SlotStartTime=${slotStart.toISOString()}, Now=${now.toISOString()}, hoursUntilSlot=${hoursUntilSlot.toFixed(2)}`);

    if (hoursUntilSlot >= 3) {
        return { percentage: 100, label: 'Full refund (>=3h notice)' };
    } else {
        // Feature removed: No plan-based protection for late cancellations anymore
        return { 
            percentage: 85, 
            label: 'Partial refund (<3h notice)' 
        };
    }
};

/**
 * Process automatic refund when an appointment is cancelled
 * 
 * @param {string} appointmentId 
 * @param {string} cancelledBy - 'user' | 'admin'
 */
const processRefund = async (appointmentId, cancelledBy) => {
    console.log(`[AutoRefund] === START === appt=${appointmentId}, by=${cancelledBy}`);
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Fetch appointment details and user plan features
        const apptRes = await client.query(
            `SELECT a.id, a.org_id, a.user_id, a.price, a.payment_status, a.status, a.payment_id,
                    s.start_time, p.features as plan_features
             FROM appointments a
             LEFT JOIN slots s ON a.slot_id = s.id
             LEFT JOIN users u ON a.user_id = u.id
             LEFT JOIN plans p ON u.plan_id = p.id
             WHERE a.id = $1::uuid`,
            [appointmentId]
        );

        const appt = apptRes.rows[0];
        if (!appt) {
            console.error(`[AutoRefund] Appointment NOT FOUND: ${appointmentId}`);
            await client.query('ROLLBACK');
            return { refunded: false, reason: 'Appointment not found' };
        }

        console.log(`[AutoRefund] Found: ID=${appt.id}, Status=${appt.status}, PaymentStatus=${appt.payment_status}, Price=${appt.price}, PaymentID=${appt.payment_id}`);

        // 2. Only process if this was a paid appointment
        if (appt.payment_status !== 'paid' || parseFloat(appt.price) <= 0) {
            console.warn(`[AutoRefund] Skipping: PaymentStatus is "${appt.payment_status}" (expected "paid") or Price is ${appt.price}.`);
            await client.query('ROLLBACK');
            return { refunded: false, reason: 'No payment to refund' };
        }

        // 3. Verify there's actually a locked transaction to refund
        const lockedTxRes = await client.query(
            `SELECT id, amount FROM wallet_transactions
             WHERE reference_id = $1::uuid AND type = 'credit' AND status = 'locked'
             LIMIT 1`,
            [appointmentId]
        );

        if (lockedTxRes.rows.length === 0) {
            console.log(`[AutoRefund] No 'locked' transaction found for Appt ${appointmentId}. Checking 'available' status...`);
            // Check if funds were already released (completed case) — refund from available
            const availableTxRes = await client.query(
                `SELECT id, amount FROM wallet_transactions
                 WHERE reference_id = $1::uuid AND type = 'credit' AND status = 'available'
                 LIMIT 1`,
                [appointmentId]
            );
            if (availableTxRes.rows.length === 0) {
                console.warn(`[AutoRefund] !!! CRITICAL: No locked OR available funds for Appointment ${appointmentId} found in wallet_transactions. This appointment cannot be auto-refunded.`);
                await client.query('ROLLBACK');
                return { refunded: false, reason: 'No locked or available funds found in wallet ledger' };
            }
            console.log(`[AutoRefund] Found 'available' transaction. Proceeding with refund from released funds.`);
        }

        // 4. Calculate refund amount with plan consideration
        const policy = getRefundPolicy(appt.start_time, cancelledBy, appt.plan_features);
        const originalAmount = parseFloat(appt.price);
        const refundAmount = parseFloat(((policy.percentage / 100) * originalAmount).toFixed(2));

        console.log(`[AutoRefund] Policy: "${policy.label}", Refund Percentage: ${policy.percentage}%, Amount: ₹${refundAmount}`);

        if (refundAmount <= 0) {
            console.log(`[AutoRefund] 0% refund policy applied. Forfeiting funds to organization.`);
            // Mark locked funds as forfeited (moved to available for org)
            await client.query(
                `UPDATE wallet_transactions SET status = 'available', description = description || ' (Forfeited - late cancellation)'
                 WHERE reference_id = $1::uuid AND type = 'credit' AND status = 'locked'`,
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
                console.log(`[AutoRefund] Triggering actual Razorpay refund for appt=${appointmentId}, payment=${appt.payment_id}, amount=₹${refundAmount}`);
                const rzpRefund = await razorpayService.refundPayment(appt.payment_id, refundAmount, {
                    appointment_id: appointmentId,
                    reason: policy.label,
                    cancelled_by: cancelledBy
                });
                razorpayRefundId = rzpRefund.id;
                console.log(`[AutoRefund] Razorpay API success: ${razorpayRefundId}`);
            } catch (rzpErr) {
                console.error(`[AutoRefund] !!! RAZORPAY ERROR appt=${appointmentId}:`, rzpErr.status, rzpErr.message);
                if (rzpErr.response) {
                    console.error(`[AutoRefund] Razorpay Response Data:`, JSON.stringify(rzpErr.response.data));
                }
                refundSuccessful = false;
            }
        } else {
            console.warn(`[AutoRefund] Skipping Razorpay API call: refundAmount=${refundAmount}, payment_id=${appt.payment_id}`);
            refundSuccessful = false;
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
             WHERE id = $4::uuid 
             RETURNING status, payment_status`,
            [finalPaymentStatus, refundAmount, razorpayRefundId, appointmentId]
        );

        if (updateApptRes.rowCount > 0) {
            console.log(`[AutoRefund] Appointment status updated to: cancelled, payment_status to: ${finalPaymentStatus}`);
        }

        // 8. Wallet finalize
        if (refundSuccessful) {
            console.log(`[AutoRefund] Finalizing internal wallet ledger for successfully refunded appt ${appointmentId}`);
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
                     WHERE reference_id = $2::uuid AND type = 'credit' AND (status = 'locked' OR status = 'available')`,
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
                 WHERE reference_id = $1::uuid AND type = 'credit' AND (status = 'locked' OR status = 'available')`,
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

        console.log(`[AutoRefund] Finished processing: appt=${appointmentId}, amount=₹${refundAmount}, policy="${policy.label}"`);

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
    const apptInfo = await pool.query(
        `SELECT a.price, a.payment_status, s.start_time, p.features as plan_features
         FROM appointments a
         LEFT JOIN slots s ON a.slot_id = s.id
         LEFT JOIN users u ON a.user_id = u.id
         LEFT JOIN plans p ON u.plan_id = p.id
         WHERE a.id = $1::uuid`,
        [appointmentId]
    );

    if (!apptInfo.rows[0]) throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');

    const appt = apptInfo.rows[0];
    if (appt.payment_status !== 'paid' || parseFloat(appt.price) <= 0) {
        return { hasPaidAmount: false };
    }

    const policy = getRefundPolicy(appt.start_time, cancelledBy, appt.plan_features);
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

/**
 * Process a 50/50 settlement for No-Show appointments.
 * User gets 50% refund, Org gets 50% payout.
 * 
 * @param {string} appointmentId 
 */
const processNoShowSettlement = async (appointmentId) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Fetch appointment details
        const apptRes = await client.query(
            `SELECT a.id, a.org_id, a.user_id, a.price, a.payment_status, a.status, a.payment_id
             FROM appointments a
             WHERE a.id = $1`,
            [appointmentId]
        );

        const appt = apptRes.rows[0];
        if (!appt) {
            await client.query('ROLLBACK');
            return { settled: false, reason: 'Appointment not found' };
        }

        // 2. Only process if this was a paid appointment
        if (appt.payment_status !== 'paid' || parseFloat(appt.price) <= 0) {
            await client.query('ROLLBACK');
            return { settled: false, reason: 'No payment to settle' };
        }

        const originalAmount = parseFloat(appt.price);
        const adminPayout = parseFloat((originalAmount * 0.70).toFixed(2));
        const platformProfit = parseFloat((originalAmount * 0.30).toFixed(2));

        console.log(`[NoShow-Settlement] Splitting ₹${originalAmount} (70/30) -> Admin: ₹${adminPayout}, Platform: ₹${platformProfit} for Appt ${appointmentId}`);

        // 3. Update Appointment (User gets 0% refund)
        await client.query(
            `UPDATE appointments 
             SET payment_status = $1, 
                 refund_amount = 0, 
                 updated_at = NOW() 
             WHERE id = $2`,
            ['no_show_settled', appointmentId]
        );

        // 4. Release 70% to Organization Wallet
        const walletRes = await client.query('SELECT id FROM wallets WHERE org_id = $1', [appt.org_id]);
        if (walletRes.rows.length > 0) {
            const walletId = walletRes.rows[0].id;
            // 70% goes to available (as no-show fee). 
            // We must also deduct the 30% commission from total_earned because the full 100% was credited as 'locked' initially.
            await client.query(
                `UPDATE wallets SET 
                    locked_funds = GREATEST(locked_funds - $1, 0), 
                    available_balance = available_balance + $2,
                    total_earned = GREATEST(total_earned - $3, 0),
                    lifetime_earned = GREATEST(lifetime_earned - $3, 0)
                 WHERE id = $4`,
                [originalAmount, adminPayout, platformProfit, walletId]
            );

            // Update original locked transaction
            await client.query(
                `UPDATE wallet_transactions SET status = 'cancelled', description = description || ' (No-Show: 70/30 split)'
                 WHERE reference_id = $1 AND type = 'credit' AND status = 'locked'`,
                [appointmentId]
            );

            // Log the payout portion (70%)
            await client.query(
                `INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description)
                 VALUES ($1, $2, 'available', 'completed', $3, $4)`,
                [walletId, adminPayout, appointmentId, `No-Show fee (70%): ${appointmentId}`]
            );

            // Log the platform profit (30%) as a separate commission entry
            await client.query(
                `INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description)
                 VALUES ($1, $2, 'commission', 'completed', $3, $4)`,
                [walletId, platformProfit, appointmentId, `Platform Commission (30%): ${appointmentId}`]
            );
        }

        await client.query('COMMIT');
        return { settled: true, userRefund: 0, adminPayout: adminPayout, platformProfit: platformProfit };

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[NoShow-Settlement] Error:`, err.message);
        throw err;
    } finally {
        client.release();
    }
};

module.exports = { processRefund, getRefundPolicy, getRefundPreview, processNoShowSettlement };

