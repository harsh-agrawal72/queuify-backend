const cron = require('node-cron');
const { pool } = require('../config/db');
const emailService = require('../services/email.service');

const checkReminders = async () => {
    try {
        const now = new Date();

        // Window for 15-minute reminder (between 10 and 25 minutes from now)
        // This ensures that even if the cron runs every 5-10 mins, we catch the window.
        const rangeStart = new Date(now.getTime() + 10 * 60 * 1000);
        const rangeEnd = new Date(now.getTime() + 25 * 60 * 1000);

        const query = `
            SELECT a.id, a.user_id, s.start_time, u.email, u.name as user_name, o.name as org_name, svc.name as service_name
            FROM appointments a
            JOIN slots s ON a.slot_id = s.id
            JOIN users u ON a.user_id = u.id
            JOIN organizations o ON a.org_id = o.id
            JOIN services svc ON a.service_id = svc.id
            WHERE a.status = 'confirmed' 
            AND a.reminder_sent = FALSE
            AND u.email_notification_enabled IS NOT FALSE
            AND s.start_time BETWEEN $1 AND $2
        `;

        const res = await pool.query(query, [rangeStart, rangeEnd]);
        const appointments = res.rows;

        if (appointments.length > 0) {
            console.log(`[Cron] Found ${appointments.length} appointments for 15-min reminder.`);
        }

        for (const appt of appointments) {
            console.log(`[Cron] Sending reminder for appt ${appt.id} to ${appt.email}`);

            try {
                await emailService.sendReminderEmail(appt.email, {
                    id: appt.id,
                    startTime: appt.start_time,
                    userName: appt.user_name,
                    orgName: appt.org_name,
                    serviceName: appt.service_name
                });

                // Mark as sent
                await pool.query('UPDATE appointments SET reminder_sent = TRUE WHERE id = $1', [appt.id]);
            } catch (err) {
                console.error(`[Cron] Failed to send reminder for appt ${appt.id}:`, err);
            }
        }
    } catch (err) {
        console.error('Reminder cron failed:', err);
    }
};

// Run every 5 minutes
const init = () => {
    cron.schedule('*/5 * * * *', checkReminders);
    console.log('Reminder cron job initialized (Target: 15-min window)');
};

module.exports = {
    init
};
