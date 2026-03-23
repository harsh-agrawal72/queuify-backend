const authService = require('./auth.service');
const emailService = require('./email.service');
const tokenService = require('./token.service');
const userService = require('./user.service');
const organizationService = require('./organization.service');
const adminService = require('./admin.service');
const serviceService = require('./service.service');
const resourceService = require('./resource.service');
const slotService = require('./slot.service');
const appointmentService = require('./appointment.service');
const superadminService = require('./superadmin.service');
const planService = require('./plan.service');
const activityService = require('./activity.service');
const notificationService = require('./notification.service');
const reassignmentService = require('./reassignment.service');
const organizationImageService = require('./organization_image.service');
const organizationProfileService = require('./organization_profile.service');

module.exports = {
    authService,
    emailService,
    tokenService,
    userService,
    organizationService,
    adminService,
    serviceService,
    resourceService,
    slotService,
    appointmentService,
    superadminService,
    planService,
    activityService,
    notificationService,
    reassignmentService,
    organizationImageService,
    organizationProfileService
};
