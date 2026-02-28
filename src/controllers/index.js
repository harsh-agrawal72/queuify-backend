const authController = require('./auth.controller');
const userController = require('./user.controller');
const organizationController = require('./organization.controller');
const adminController = require('./admin.controller');
const serviceController = require('./service.controller');
const resourceController = require('./resource.controller');
const slotController = require('./slot.controller');
const appointmentController = require('./appointment.controller');
const superadminController = require('./superadmin.controller');
const planController = require('./plan.controller');

module.exports = {
    authController,
    userController,
    organizationController,
    adminController,
    serviceController,
    resourceController,
    slotController,
    appointmentController,
    superadminController,
    planController
};
