/**
 * settlement.js — Midnight Settlement Cron
 *
 * Runs daily at midnight (00:00) to auto-release locked escrow funds for
 * any appointments that are either:
 *   (a) Marked as 'completed' but funds are still locked (e.g. OTP was verified
 *       but releaseFunds was somehow skipped), OR
 *   (b) Appointments whose slot ended > 2 hours ago with status 'confirmed'/'serving'
 *       (safety net for abandoned/missed OTP verifications).
 *
 * Also handles: detection of admin no-shows and admin penalty deductions.
 */

const cron = require('node-cron');
const { pool } = require('../config/db');
const walletService = require('../services/wallet.service');

// ─────────────────────────────────────────────
// Core Settlement Logic (exported for manual trigger)
// ─────────────────────────────────────────────
const runSettlement = async () => {
    const startTime = Date.now();
    console.log('[Settlement] Starting settlement run at:', new Date().toISOString());

    let released = 0;
    let penalized = 0;
    let errors = 0;

    try {
        // ── Case 1: Completed appointments with locked funds ──
        // These are appointments verified by OTP but where releaseFunds may not have
        // fired correctly (defensive safety net).
        const completedQuery = `
            SELECT DISTINCT a.id as appointment_id, a.org_id, a.price
            FROM appointments a
            JOIN wallet_transactions wt ON wt.reference_id::text = a.id::text
            WHERE a.status = 'completed'
              AND a.payment_status = 'paid'
              AND wt.type = 'credit'
              AND wt.status = 'locked'
              AND a.updated_at < NOW() - INTERVAL '30 minutes'
        `;
        const completedRes = await pool.query(completedQuery);
        console.log(`[Settlement] Found ${completedRes.rows.length} completed appointments with locked funds`);

        for (const row of completedRes.rows) {
            try {
                await walletService.releaseFunds(row.org_id, row.appointment_id);
                released++;
                console.log(`[Settlement] Released locked funds for completed appointment ${row.appointment_id}`);
            } catch (e) {
                errors++;
                console.error(`[Settlement] Error releasing for appt ${row.appointment_id}:`, e.message);
            }
        }

        // ── Case 2: No-Shows & Stale appointments (slot ended > 2 hrs ago) ──
        // Admin gets paid for No-Shows. Stale appointments are also auto-released
        // as a safety net, UNLESS there is an active dispute.
        const staleQuery = `
            SELECT DISTINCT a.id as appointment_id, a.org_id, a.price, s.end_time
            FROM appointments a
            JOIN slots s ON a.slot_id = s.id
            JOIN wallet_transactions wt ON wt.reference_id::text = a.id::text
            WHERE (a.status IN ('confirmed', 'serving', 'pending') OR a.status = 'no_show')
              -- ONLY release if NOT disputed
              AND a.dispute_status = 'none'
              AND a.payment_status = 'paid'
              AND wt.type = 'credit'
              AND wt.status = 'locked'
              AND s.end_time < NOW() - INTERVAL '2 hours'
        `;
        const staleRes = await pool.query(staleQuery);
        console.log(`[Settlement] Found ${staleRes.rows.length} no-show/stale appointments with locked funds`);

        for (const row of staleRes.rows) {
            try {
                // Mark as completed/settled (Case D: No-show earns admin money)
                // If it was still 'confirmed', we auto-complete it.
                await pool.query(
                    "UPDATE appointments SET status = CASE WHEN status = 'no_show' THEN 'no_show' ELSE 'completed' END, updated_at = NOW() WHERE id = $1",
                    [row.appointment_id]
                );
                await walletService.releaseFunds(row.org_id, row.appointment_id);
                released++;
                console.log(`[Settlement] Settled no-show/stale appointment ${row.appointment_id}`);
            } catch (e) {
                errors++;
                console.error(`[Settlement] Error processing stale appt ${row.appointment_id}:`, e.message);
            }
        }

        // ── Case 3: Admin Penalty — Last-Minute Admin Cancellations ──
        // If an admin cancelled a paid appointment within 4 hours of its slot,
        // deduct ₹20 penalty from their wallet (if not already penalized).
        const penaltyQuery = `
            SELECT DISTINCT a.id as appointment_id, a.org_id, a.price, s.start_time
            FROM appointments a
            JOIN slots s ON a.slot_id = s.id
            WHERE a.status = 'cancelled'
              AND a.cancelled_by = 'admin'
              AND a.payment_status = 'paid'
              AND a.price > 0
              AND NOT EXISTS (
                  SELECT 1 FROM wallet_transactions wt2
                  WHERE wt2.reference_id::text = a.id::text
                    AND wt2.type = 'penalty'
              )
              AND (s.start_time - a.updated_at) < INTERVAL '4 hours'
              AND a.updated_at > NOW() - INTERVAL '24 hours'
        `;
        const penaltyRes = await pool.query(penaltyQuery);
        console.log(`[Settlement] Found ${penaltyRes.rows.length} admin cancellations eligible for penalty`);

        for (const row of penaltyRes.rows) {
            try {
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');

                    const walletRes = await client.query(
                        'SELECT id FROM wallets WHERE org_id = $1',
                        [row.org_id]
                    );
                    if (walletRes.rows.length === 0) {
                        await client.query('ROLLBACK');
                        continue;
                    }
                    const walletId = walletRes.rows[0].id;
                    const PENALTY_AMOUNT = 20; // ₹20 admin penalty

                    // Deduct from wallet
                    await client.query(
                        'UPDATE wallets SET balance = GREATEST(balance - $1, 0) WHERE id = $2',
                        [PENALTY_AMOUNT, walletId]
                    );

                    // Log penalty in ledger
                    await client.query(
                        `INSERT INTO wallet_transactions 
                         (wallet_id, amount, type, status, reference_id, description)
                         VALUES ($1, $2, 'penalty', 'completed', $3, $4)`,
                        [walletId, -PENALTY_AMOUNT, row.appointment_id, `Admin cancellation penalty for appointment ${row.appointment_id}`]
                    );

                    await client.query('COMMIT');
                    penalized++;
                    console.log(`[Settlement] Applied ₹${PENALTY_AMOUNT} penalty for org ${row.org_id}, appt ${row.appointment_id}`);
                } catch (innerErr) {
                    await client.query('ROLLBACK');
                    throw innerErr;
                } finally {
                    client.release();
                }
            } catch (e) {
                errors++;
                console.error(`[Settlement] Penalty error for appt ${row.appointment_id}:`, e.message);
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        const summary = {
            released,
            penalized,
            errors,
            durationSeconds: duration,
            timestamp: new Date().toISOString()
        };
        console.log('[Settlement] Run complete:', summary);
        return summary;

    } catch (err) {
        console.error('[Settlement] Fatal error during settlement run:', err);
        throw err;
    }
};

// ─────────────────────────────────────────────
// Cron Schedule: Every day at midnight (00:00)
// ─────────────────────────────────────────────
const init = () => {
    // Run at midnight every day
    cron.schedule('0 0 * * *', async () => {
        console.log('[Settlement-Cron] Midnight trigger fired');
        await runSettlement().catch(e => console.error('[Settlement-Cron] Run failed:', e.message));
    }, {
        timezone: 'Asia/Kolkata' // IST timezone
    });

    // Also run every hour to catch any stale records quickly
    cron.schedule('0 * * * *', async () => {
        console.log('[Settlement-Cron] Hourly stale-check trigger');
        await runSettlement().catch(e => console.error('[Settlement-Cron] Hourly run failed:', e.message));
    });

    console.log('[Settlement-Cron] Initialized — Midnight settlement + hourly stale-check active');
};

module.exports = { init, runSettlement };
