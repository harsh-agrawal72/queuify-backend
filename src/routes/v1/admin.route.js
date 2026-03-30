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
router.patch('/org', validate(adminValidation.updateOrgDetails), adminController.updateOrgDetails);
router.delete('/org', adminController.deleteOrganization);
router.get('/today-queue', adminController.getTodayQueue);
router.get('/analytics', adminController.getAnalytics);
router.get('/live-queue', adminController.getLiveQueue);
router.get('/predictive-insights', adminController.getPredictiveInsights);
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
    .get(adminController.getAppointments)
    .post(validate(adminValidation.createManualAppointment), adminController.createManualAppointment);

router.route('/appointments/:appointmentId')
    .patch(validate(adminValidation.updateAppointmentStatus), adminController.updateAppointmentStatus)
    .delete(validate(adminValidation.deleteAppointment), adminController.deleteAppointment);

router.post('/appointments/:appointmentId/retry-refund', adminController.retryRefund);

router.get('/admins', adminController.getAdmins);
router.post('/admins/invite', validate(adminValidation.inviteAdmin), adminController.inviteAdmin);
router.delete('/admins/:adminId', validate(adminValidation.deleteAdmin), adminController.deleteAdmin);

router.post('/rebalance/:resourceId', adminController.rebalanceSlots);

// Customer Loyalty & History
router.get('/users/:userId/loyalty', adminController.getUserLoyalty);
router.get('/users/:userId/history', adminController.getUserHistory);

module.exports = router;
