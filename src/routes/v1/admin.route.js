const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const adminValidation = require('../../validations/admin.validation');
const adminController = require('../../controllers/admin.controller');

const checkOrgStatus = require('../../middlewares/checkOrgStatus');

const router = express.Router();

// All routes require 'admin' role
router.use(auth('admin'));
router.use(checkOrgStatus);

router.get('/overview', adminController.getOverview);
router.get('/org', adminController.getOrgDetails);
router.patch('/org', adminController.updateOrgDetails);
router.get('/today-queue', adminController.getTodayQueue);
router.get('/analytics', adminController.getAnalytics);
router.get('/live-queue', adminController.getLiveQueue);
router.get('/notifications', adminController.getNotifications);
router.post('/notifications/mark-read', adminController.markAllNotificationsAsRead);

router.get('/search', adminController.globalSearch);

router.route('/slots')
    .get(adminController.getSlots)
    .post(validate(adminValidation.createSlot), adminController.createSlot);

router.route('/slots/:slotId')
    .patch(validate(adminValidation.updateSlot), adminController.updateSlot)
    .delete(validate(adminValidation.deleteSlot), adminController.deleteSlot);

router.route('/appointments')
    .get(adminController.getAppointments);

router.route('/appointments/:appointmentId')
    .patch(validate(adminValidation.updateAppointmentStatus), adminController.updateAppointmentStatus)
    .delete(validate(adminValidation.deleteAppointment), adminController.deleteAppointment);

module.exports = router;
