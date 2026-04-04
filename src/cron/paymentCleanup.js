const cron = require('node-cron');
const { pool } = require('../config/db');

/**
 * Periodically cleans up appointments that were started but never paid for.
 * This releases slot capacity and keeps the database clean.
 */
const cleanupAbandonedPayments = async () => {
    try {
        // Dynamic require to avoid circular dependencies
        const appointmentService = require('../services/appointment.service');
        
        // 1. Find appointments in 'pending_payment' older than 15 minutes
        // We use 15 minutes as a safe buffer for active payment attempts.
        // Even if the user is slow, most payment gateways timeout orders after 10-15 mins.
        const query = `
            SELECT id, user_id, org_id, slot_id
            FROM appointments 
            WHERE status = 'pending_payment' 
            AND created_at < NOW() - INTERVAL '15 minutes'
        `;
        
        const res = await pool.query(query);
        const toCleanup = res.rows;

        if (toCleanup.length > 0) {
            console.log(`[Cron-Cleanup] Found ${toCleanup.length} abandoned payments older than 15 mins.`);
            
            for (const appt of toCleanup) {
                try {
                    // Reuse the existing service logic to handle slot decrement and deletion
                    await appointmentService.cancelPendingPayment(appt.id, appt.user_id);
                } catch (innerErr) {
                    console.error(`[Cron-Cleanup] Failed to clear appt ${appt.id}:`, innerErr.message);
                }
            }
            console.log(`[Cron-Cleanup] Cleanup cycle finished.`);
        }
    } catch (err) {
        console.error('[Cron-Cleanup] Global failure:', err);
    }
};

/**
 * Initialize the cron job
 */
const init = () => {
    // Run every 5 minutes to sweep for stale records
    cron.schedule('*/5 * * * *', cleanupAbandonedPayments);
    console.log('Abandoned Payment Cleanup cron initialized (15-min TTL, sweeps every 5m)');
};

module.exports = {
    init,
    cleanupAbandonedPayments
};
