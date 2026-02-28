const { pool } = require('../config/db');

/**
 * Create a new notification
 */
const createNotification = async (data) => {
    const { userId, title, message, type = 'system', link = null } = data;
    const result = await pool.query(
        'INSERT INTO notifications (user_id, title, message, type, link) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [userId, title, message, type, link]
    );
    return result.rows[0];
};

/**
 * Get all notifications for a user
 */
const getUserNotifications = async (userId) => {
    const result = await pool.query(
        'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
        [userId]
    );
    return result.rows;
};

/**
 * Mark a notification as read
 */
const markAsRead = async (notificationId) => {
    const result = await pool.query(
        'UPDATE notifications SET is_read = true WHERE id = $1 RETURNING *',
        [notificationId]
    );
    return result.rows[0];
};

/**
 * Mark all notifications as read for a user
 */
const markAllAsRead = async (userId) => {
    await pool.query(
        'UPDATE notifications SET is_read = true WHERE user_id = $1',
        [userId]
    );
};

/**
 * Delete a notification
 */
const deleteNotification = async (notificationId) => {
    await pool.query('DELETE FROM notifications WHERE id = $1', [notificationId]);
};

module.exports = {
    createNotification,
    getUserNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification
};
