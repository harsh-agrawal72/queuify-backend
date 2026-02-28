const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const superadminValidation = require('../../validations/superadmin.validation');
const superadminController = require('../../controllers/superadmin.controller');

const router = express.Router();

// Require 'superadmin' role
router.use(auth('superadmin'));

router.get('/overview', superadminController.getOverview);
router.get('/monitor', superadminController.getGlobalMonitor);

router.route('/organizations')
    .get(superadminController.getOrganizations)
    .post(validate(superadminValidation.createOrganization), superadminController.createOrganization);

router.route('/organizations/:orgId')
    .patch(validate(superadminValidation.updateOrganization), superadminController.updateOrganization)
    .delete(superadminController.permanentDeleteOrganization);

router.post('/organizations/:orgId/impersonate', superadminController.impersonateAdmin);

router.patch('/organizations/:orgId/suspend', superadminController.suspendOrganization);
router.patch('/organizations/:orgId/activate', superadminController.activateOrganization);

router.route('/admins')
    .get(superadminController.getAdmins)
    .post(superadminController.inviteAdmin);

router.post('/admins/invite', superadminController.inviteAdmin);
router.post('/admins/:id/resend-invite', superadminController.resendInvite);
router.patch('/admins/:id/status', superadminController.updateAdminStatus);
router.delete('/admins/:id', superadminController.deleteAdmin);

router.route('/appointments')
    .get(superadminController.getGlobalAppointments);

router.route('/appointments/:id')
    .delete(superadminController.cancelAppointment);

router.get('/analytics', superadminController.getAnalytics);
router.get('/system', superadminController.getSystemHealth);
router.get('/activity', superadminController.getRecentActivity);

module.exports = router;
