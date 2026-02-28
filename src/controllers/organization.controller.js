const httpStatus = require('../utils/httpStatus');
const catchAsync = require('../utils/catchAsync');
const { organizationService } = require('../services');
const ApiError = require('../utils/ApiError');

const createOrganization = catchAsync(async (req, res) => {
    const organization = await organizationService.createOrganization(req.body);
    res.status(httpStatus.CREATED).send(organization);
});

const getOrganizations = catchAsync(async (req, res) => {
    const filter = {
        search: req.query.search,
        type: req.query.type,
        status: req.user.role === 'user' ? 'active' : req.query.status
    };
    const result = await organizationService.queryOrganizations(filter);
    res.send(result);
});

const getOrganization = catchAsync(async (req, res) => {
    const organization = await organizationService.getOrganizationById(req.params.orgId);
    if (!organization) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found');
    }
    res.send(organization);
});

const updateOrganizationStatus = catchAsync(async (req, res) => {
    const organization = await organizationService.updateOrganizationStatus(req.params.orgId, req.body.status);
    res.send(organization);
});

const getPublicOrganizations = catchAsync(async (req, res) => {
    const filter = {
        search: req.query.search,
        type: req.query.type,
        status: 'active'
    };
    const orgs = await organizationService.queryOrganizations(filter);
    // Return safe data for public
    const publicList = orgs.map(o => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        org_code: o.org_code,
        type: o.type,
        avg_rating: Number(Number(o.avg_rating || 0).toFixed(1)),
        total_reviews: parseInt(o.total_reviews || 0)
    }));
    res.send(publicList);
});

const getOrganizationBySlug = catchAsync(async (req, res) => {
    console.log('Lookup organization by slug:', req.params.slug);
    const organization = await organizationService.getOrganizationBySlug(req.params.slug);
    console.log('Organization found:', organization?.id, organization?.name);
    res.send(organization);
});

const getOrgImage = catchAsync(async (req, res) => {
    const { imageId } = req.params;
    const { pool } = require('../config/db');

    const result = await pool.query('SELECT image_data, mime_type FROM organization_images WHERE id = $1', [imageId]);

    if (result.rows.length === 0 || !result.rows[0].image_data) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Image not found');
    }

    const { image_data, mime_type } = result.rows[0];
    res.set('Content-Type', mime_type || 'image/jpeg');
    res.send(image_data);
});

module.exports = {
    createOrganization,
    getOrganizations, // Now supports search query
    getOrganization,
    updateOrganizationStatus,
    getPublicOrganizations,
    getOrganizationBySlug,
    getOrgImage
};
