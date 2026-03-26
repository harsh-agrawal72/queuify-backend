const notificationModel = require('../models/notification.model');
const { pool } = require('../config/db');
const socket = require('../socket/index');

/**
 * Send a notification to a user (respects notification_enabled preference)
 */
const sendNotification = async (userId, title, message, type, link) => {
    try {
        // Check if user has notifications enabled
        const userRes = await pool.query('SELECT notification_enabled FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length > 0 && userRes.rows[0].notification_enabled === false) {
            return null; // User has disabled notifications
        }
    } catch (err) {
        console.error('Failed to check notification preference:', err.message);
    }
    
    // 1. Create DB Notification
    const notification = await notificationModel.createNotification({ userId, title, message, type, link });

    // 2. Emit real-time WebSocket event directly to user
    try {
        const io = socket.getIO();
        if (io) {
            io.to(`user_${userId}`).emit('new_notification', {
                title,
                message,
                type,
                link,
                createdAt: new Date().toISOString()
            });
        }
    } catch (err) {
        console.error('Failed to emit real-time notification via sockets:', err.message);
    }

    return notification;
};

/**
 * Get user notifications
 */
const getNotifications = async (userId) => {
    return notificationModel.getUserNotifications(userId);
};

/**
 * Mark notification as read
 */
const markAsRead = async (notificationId) => {
    return notificationModel.markAsRead(notificationId);
};

/**
 * Mark all as read
 */
const markAllAsRead = async (userId) => {
    await notificationModel.markAllAsRead(userId);
};

module.exports = {
    sendNotification,
    getNotifications,
    markAsRead,
    markAllAsRead
};
