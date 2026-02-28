const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const organizationValidation = require('../../validations/organization.validation');
const organizationController = require('../../controllers/organization.controller');
const organizationProfileController = require('../../controllers/organization_profile.controller');
const upload = require('../../utils/upload');
const catchAsync = require('../../utils/catchAsync');
const resourceService = require('../../services/resource.service');
const { pool } = require('../../config/db');

const router = express.Router();

// Public route — for signup dropdown (returns id + name only)
router.get('/public', organizationController.getPublicOrganizations);

// Image serving route
router.get('/image/:imageId', organizationController.getOrgImage);

// Organization Profile Routes
router.route('/profile')
    .get(auth('admin'), organizationProfileController.getProfile)
    .patch(auth('admin'), organizationProfileController.updateProfile);

router.get('/:orgId/profile', auth('user', 'admin'), organizationProfileController.getPublicProfile);

// Organization Media Routes
router.post('/images', auth('admin'), upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'cover', maxCount: 1 },
    { name: 'gallery', maxCount: 10 }
]), organizationProfileController.uploadImages);

router.delete('/images/:id', auth('admin'), organizationProfileController.deleteImage);

// Only Superadmin can create, view all, or update status of organizations
router.route('/')
    .post(auth('superadmin'), validate(organizationValidation.createOrganization), organizationController.createOrganization)
    .get(auth('superadmin', 'user'), organizationController.getOrganizations);

router.route('/:orgId')
    .get(auth('superadmin', 'admin', 'user'), validate(organizationValidation.getOrganization), organizationController.getOrganization)
    .patch(auth('superadmin'), validate(organizationValidation.updateOrganizationStatus), organizationController.updateOrganizationStatus);

router.get('/slug/:slug', auth('user', 'admin'), organizationController.getOrganizationBySlug);

// Public/User routes for booking flow
router.get('/:orgId/services', auth('user', 'admin'), require('../../controllers/service.controller').getServicesByOrg);
router.get('/:orgId/slots', auth('user', 'admin'), require('../../controllers/slot.controller').getAvailableSlots);

// Booking flow: Get resources for a service
router.get('/:orgId/services/:serviceId/resources', auth('user', 'admin'), require('../../controllers/resource.controller').getResourcesByService);

// Booking flow: Get available slots for a resource (using flexible available slots fetcher)
router.get('/:orgId/resources/:resourceId/slots', auth('user', 'admin'), (req, res, next) => {
    req.query.resourceId = req.params.resourceId;
    require('../../controllers/slot.controller').getAvailableSlots(req, res, next);
});

module.exports = router;
