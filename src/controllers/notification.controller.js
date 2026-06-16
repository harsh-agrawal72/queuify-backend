const catchAsync = require('../utils/catchAsync');
const notificationService = require('../services/notification.service');

const getNotifications = catchAsync(async (req, res) => {
    const notifications = await notificationService.getNotifications(req.user.id);
    // Allow client to cache notifications for 10s, refresh stale in background
    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=20');
    res.json(notifications);
});

const markAsRead = catchAsync(async (req, res) => {
    const notification = await notificationService.markAsRead(req.params.notificationId);
    res.json(notification);
});

const markAllAsRead = catchAsync(async (req, res) => {
    await notificationService.markAllAsRead(req.user.id);
    res.json({ message: 'All notifications marked as read' });
});

const savePushToken = catchAsync(async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: 'Token is required' });
    await notificationService.savePushToken(req.user.id, token);
    res.json({ message: 'Push token saved successfully' });
});

module.exports = {
    getNotifications,
    markAsRead,
    markAllAsRead,
    savePushToken
};
