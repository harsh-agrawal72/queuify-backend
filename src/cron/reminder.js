const cron = require('node-cron');
const { pool } = require('../config/db');
const emailService = require('../services/email.service');

const checkReminders = async () => {
    try {
        const now = new Date();
        const appointmentService = require('../services/appointment.service');
        const notificationService = require('../services/notification.service');

        // 1. Fetch appointments that haven't received BOTH reminders yet and are scheduled for today
        // Note: we fetch if EITHER reminder_sent is false OR way_reminder_sent is false
        const query = `
            SELECT a.id, a.user_id, a.service_id, a.resource_id, a.org_id, a.slot_id, 
                   a.reminder_sent, a.way_reminder_sent,
                   u.email, u.name as user_name, u.email_notification_enabled,
                   o.name as org_name, svc.name as service_name
            FROM appointments a
            JOIN slots s ON a.slot_id = s.id
            JOIN users u ON a.user_id = u.id
            JOIN organizations o ON a.org_id = o.id
            JOIN services svc ON a.service_id = svc.id
            WHERE a.status IN ('confirmed', 'pending', 'serving')
            AND (a.reminder_sent = FALSE OR a.way_reminder_sent = FALSE)
            AND s.start_time >= $1
            AND s.start_time <= $2
        `;

        // Look at candidates in a generous 4-hour window from now to account for delays/early progress
        const lookAheadStart = new Date(now.getTime() - 30 * 60000); // 30 mins ago
        const lookAheadEnd = new Date(now.getTime() + 4 * 60 * 60000); // 4 hours ahead
        
        const res = await pool.query(query, [lookAheadStart, lookAheadEnd]);
        const candidates = res.rows;

        for (const appt of candidates) {
            try {
                // 2. Get AI-powered status
                const status = await appointmentService.getQueueStatus(appt.id);
                if (!status.expected_start_time) continue;

                const expectedTime = new Date(status.expected_start_time);
                const diffMinutes = (expectedTime.getTime() - now.getTime()) / 60000;

                // 3. TARGET: 30-Minute General Reminder (Window: 25 to 35 mins)
                if (!appt.reminder_sent && diffMinutes >= 25 && diffMinutes <= 35) {
                    console.log(`[Cron-AI] Sending 30-min arrival reminder for appt ${appt.id}`);

                    // A. In-App Notification
                    await notificationService.sendNotification(
                        appt.user_id,
                        '⏰ Arrival Reminder',
                        `Your appointment for ${appt.service_name} at ${appt.org_name} is in approx. 30 mins. Please arrive on time.`,
                        'appointment',
                        `/appointments/${appt.id}/queue`
                    );

                    // B. Email Notification
                    if (appt.email && appt.email_notification_enabled !== false) {
                        await emailService.sendReminderEmail(appt.email, {
                            id: appt.id,
                            startTime: expectedTime,
                            userName: appt.user_name,
                            orgName: appt.org_name,
                            serviceName: appt.service_name,
                            isAI: true
                        }).catch(e => console.error(`[Cron-Email] Failed:`, e.message));
                    }

                    // C. Mark as sent
                    await pool.query('UPDATE appointments SET reminder_sent = TRUE WHERE id = $1', [appt.id]);
                }

                // 4. TARGET: 10-Minute "On the Way" Reminder (Window: 8 to 14 mins)
                if (!appt.way_reminder_sent && diffMinutes >= 8 && diffMinutes <= 14) {
                    console.log(`[Cron-AI] Sending 10-min "On the Way" reminder for appt ${appt.id}`);

                    // A. In-App Notification
                    await notificationService.sendNotification(
                        appt.user_id,
                        '🚀 Almost Your Turn!',
                        `You are expected in 10 mins! Please click "On the Way" if you are heading here.`,
                        'appointment',
                        `/appointments`
                    );

                    // B. Email Notification
                    if (appt.email && appt.email_notification_enabled !== false) {
                        await emailService.sendWayReminderEmail(appt.email, {
                            id: appt.id,
                            startTime: expectedTime,
                            userName: appt.user_name,
                            orgName: appt.org_name,
                            serviceName: appt.service_name
                        }).catch(e => console.error(`[Cron-Email-Way] Failed:`, e.message));
                    }

                    // C. Mark as sent
                    await pool.query('UPDATE appointments SET way_reminder_sent = TRUE WHERE id = $1', [appt.id]);
                }

            } catch (innerErr) {
                console.error(`[Cron-AI] Error processing appt ${appt.id}:`, innerErr.message);
            }
        }
    } catch (err) {
        console.error('AI Reminder cron failed:', err);
    }
};

// Run every 2 minutes
const init = () => {
    cron.schedule('*/2 * * * *', checkReminders);
    console.log('AI-Powered reminders initialized (Targets: 30-min window & 10-min window)');
};

module.exports = {
    init
};
