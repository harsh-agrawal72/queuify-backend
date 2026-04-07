const admin = require('../config/firebase');
const { pool } = require('../config/db');

/**
 * Save a push token for a user
 */
const savePushToken = async (userId, token) => {
    return await pool.query(
        'UPDATE users SET push_token = $1, updated_at = NOW() WHERE id = $2 RETURNING id',
        [token, userId]
    );
};

/**
 * Send an in-app notification (saved to DB) AND a push notification (if token exists)
 */
const sendNotification = async (userId, title, message, type = 'general', link = '/') => {
    try {
        // 1. Save to Database (In-App Notification)
        // Note: Assuming a 'notifications' table exists based on controller usage
        const dbResult = await pool.query(
            'INSERT INTO notifications (user_id, title, message, type, link, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *',
            [userId, title, message, type, link]
        );

        // 2. Fetch User's Push Token
        const userRes = await pool.query('SELECT push_token FROM users WHERE id = $1', [userId]);
        const pushToken = userRes.rows[0]?.push_token;

        // 3. Send Push Notification if token exists
        if (pushToken) {
            await sendPushNotification(pushToken, {
                title,
                body: message,
                click_action: link
            });
        }

        return dbResult.rows[0];
    } catch (error) {
        console.error('Error in sendNotification:', error.message);
        // Don't throw, we want at least one part to succeed if possible
        return null;
    }
};

/**
 * Send a raw push notification via FCM
 */
const sendPushNotification = async (token, payload) => {
    if (!token) return;

    const message = {
        notification: {
            title: payload.title,
            body: payload.body,
        },
        data: payload.data || {},
        token: token,
        webpush: {
            notification: {
                icon: payload.icon || '/logo192.png',
                click_action: payload.click_action || '/',
            },
        },
    };

    try {
        const response = await admin.messaging().send(message);
        return response;
    } catch (error) {
        if (error.code === 'messaging/registration-token-not-registered') {
            console.warn('Push token expired. Removing from DB...');
            await pool.query('UPDATE users SET push_token = NULL WHERE push_token = $1', [token]);
        } else {
            console.error('FCM Error:', error);
        }
    }
};

/**
 * Get internal notifications for a user
 */
const getNotifications = async (userId) => {
    const result = await pool.query(
        'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
        [userId]
    );
    return result.rows;
};

/**
 * Mark a single notification as read
 */
const markAsRead = async (notificationId) => {
    const result = await pool.query(
        'UPDATE notifications SET is_read = TRUE WHERE id = $1 RETURNING *',
        [notificationId]
    );
    return result.rows[0];
};

/**
 * Mark all notifications as read for a user
 */
const markAllAsRead = async (userId) => {
    return await pool.query(
        'UPDATE notifications SET is_read = TRUE WHERE user_id = $1',
        [userId]
    );
};

module.exports = {
    sendNotification,
    sendPushNotification,
    getNotifications,
    markAsRead,
    markAllAsRead,
    savePushToken
};
