const express = require('express');
const auth = require('../../middlewares/auth');
const notificationController = require('../../controllers/notification.controller');

const router = express.Router();

router.use(auth());

router.get('/', notificationController.getNotifications);
router.patch('/:notificationId/read', notificationController.markAsRead);
router.patch('/read-all', notificationController.markAllAsRead);

module.exports = router;
