const cron = require('node-cron');
const { pool } = require('../config/db');

/**
 * Periodically cleans up appointments that were started but never paid for.
 * 
 * IMPORTANT: Before deleting, this function checks if the Razorpay order was
 * actually captured. If it was, it auto-confirms the appointment instead of
 * deleting it. This handles the "user paid but browser closed" case.
 */
const cleanupAbandonedPayments = async () => {
    try {
        const appointmentService = require('../services/appointment.service');
        const walletService = require('../services/wallet.service');
        const appointmentModel = require('../models/appointment.model');
        
        // 1. Find appointments in 'pending_payment' older than 30 minutes
        // INCREASED to 30 mins (was 15) to give Razorpay webhooks time to arrive first.
        // Razorpay webhooks typically arrive within seconds-to-minutes of payment capture.
        const query = `
            SELECT id, user_id, org_id, slot_id, razorpay_order_id, payment_status
            FROM appointments 
            WHERE status = 'pending_payment' 
            AND created_at < NOW() - INTERVAL '30 minutes'
        `;
        
        const res = await pool.query(query);
        const toCleanup = res.rows;

        if (toCleanup.length === 0) return;

        console.log(`[Cron-Cleanup] Found ${toCleanup.length} pending_payment appointments older than 30 mins.`);
        
        for (const appt of toCleanup) {
            try {
                // 2. CHECK RAZORPAY FIRST: If we have an order ID, check if it was captured
                if (appt.razorpay_order_id && !appt.razorpay_order_id.startsWith('order_mock_')) {
                    try {
                        const razorpayService = require('../services/razorpay.service');
                        const rzp = razorpayService.getRazorpayInstance();
                        const order = await rzp.orders.fetch(appt.razorpay_order_id);
                        
                        // Order status 'paid' means payment was captured by Razorpay
                        if (order && order.status === 'paid') {
                            console.log(`[Cron-Cleanup] Order ${appt.razorpay_order_id} is PAID. Auto-confirming Appt ${appt.id} instead of deleting.`);
                            
                            // Fetch the payment details
                            const payments = await rzp.orders.fetchPayments(appt.razorpay_order_id);
                            const capturedPayment = payments.items?.find(p => p.status === 'captured');
                            const paymentId = capturedPayment?.id || `pay_reconciled_${Date.now()}`;
                            
                            // Confirm the appointment atomically
                            const client = await pool.connect();
                            try {
                                await client.query('BEGIN');
                                await client.query(
                                    "UPDATE appointments SET payment_status = 'paid', payment_id = $1, status = 'confirmed'::appointment_status, updated_at = NOW() WHERE id = $2::uuid AND status = 'pending_payment'",
                                    [paymentId, appt.id]
                                );
                                
                                // Credit wallet
                                const fullAppt = await pool.query('SELECT * FROM appointments WHERE id = $1', [appt.id]);
                                if (fullAppt.rows.length > 0) {
                                    const basePrice = parseFloat(fullAppt.rows[0].price);
                                    await walletService.creditLockedFunds(
                                        appt.org_id,
                                        basePrice,
                                        appt.id,
                                        `Payment Reconciled (Cron) for Appointment ${appt.id}`,
                                        client
                                    );
                                }
                                
                                await client.query('COMMIT');
                                console.log(`[Cron-Cleanup] ✅ Reconciled Appt ${appt.id} successfully.`);

                                // Send notifications async
                                const queueNumber = await appointmentModel.getAppointmentRank(appt.id);
                                appointmentService.finalizeBookingNotifications(appt.id, queueNumber);
                            } catch (reconcileErr) {
                                await client.query('ROLLBACK').catch(() => {});
                                console.error(`[Cron-Cleanup] Reconciliation failed for appt ${appt.id}:`, reconcileErr.message);
                            } finally {
                                client.release();
                            }
                            
                            // SKIP deletion — appointment is now confirmed
                            continue;
                        }
                        
                        console.log(`[Cron-Cleanup] Order ${appt.razorpay_order_id} status is '${order?.status}'. Proceeding with cleanup.`);
                    } catch (rzpErr) {
                        // If Razorpay API call fails (network etc.), SKIP deletion to be safe
                        console.error(`[Cron-Cleanup] Could not verify Razorpay order ${appt.razorpay_order_id} for appt ${appt.id}. Skipping to be safe. Error: ${rzpErr.message}`);
                        continue;
                    }
                }
                
                // 3. SAFE TO DELETE — No order captured
                await appointmentService.cancelPendingPayment(appt.id, appt.user_id);
                console.log(`[Cron-Cleanup] Deleted abandoned appt ${appt.id}.`);
            } catch (innerErr) {
                console.error(`[Cron-Cleanup] Failed to process appt ${appt.id}:`, innerErr.message);
            }
        }
        
        console.log(`[Cron-Cleanup] Cleanup cycle finished.`);
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
    console.log('Abandoned Payment Cleanup cron initialized (30-min TTL, sweeps every 5m, with Razorpay reconciliation)');
};

module.exports = {
    init,
    cleanupAbandonedPayments
};
