const { pool } = require('../config/db');

/**
 * Create a slot notification request
 */
const createNotificationRequest = async (data) => {
    const { userId, slotId, desiredTime, serviceId, resourceId, autoBook = false, customerPhone = null } = data;
    const result = await pool.query(
        `INSERT INTO slot_notifications 
         (user_id, slot_id, desired_time, service_id, resource_id, auto_book, customer_phone) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING *`,
        [userId, slotId, desiredTime, serviceId, resourceId, autoBook, customerPhone]
    );
    return result.rows[0];
};

const getPendingNotificationsForSlot = async (slotId, currentEstimatedTime) => {
    const result = await pool.query(
        `SELECT sn.*, 
                u.name as user_name, u.email as user_email, 
                u.email_notification_enabled, u.notification_enabled,
                o.email_notification as org_email_enabled, o.new_booking_notification as org_notify_enabled
         FROM slot_notifications sn
         JOIN users u ON sn.user_id = u.id
         JOIN services s ON sn.service_id = s.id
         JOIN organizations o ON s.org_id = o.id
         WHERE sn.slot_id = $1 AND sn.status = 'pending' AND sn.desired_time <= $2`,
        [slotId, currentEstimatedTime]
    );
    return result.rows;
};

/**
 * Mark notifications as notified
 */
const markAsNotified = async (notificationIds) => {
    if (!notificationIds || notificationIds.length === 0) return;
    await pool.query(
        'UPDATE slot_notifications SET status = \'notified\' WHERE id = ANY($1)',
        [notificationIds]
    );
};

module.exports = {
    createNotificationRequest,
    getPendingNotificationsForSlot,
    markAsNotified
};
