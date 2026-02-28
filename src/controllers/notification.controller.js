const catchAsync = require('../utils/catchAsync');
const notificationService = require('../services/notification.service');

const getNotifications = catchAsync(async (req, res) => {
    const notifications = await notificationService.getNotifications(req.user.id);
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

module.exports = {
    getNotifications,
    markAsRead,
    markAllAsRead
};
