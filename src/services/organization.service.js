const httpStatus = require('../utils/httpStatus');
const organizationModel = require('../models/organization.model');
const ApiError = require('../utils/ApiError');

/**
 * Create an organization
 * @param {Object} orgBody
 * @returns {Promise<Object>}
 */
const createOrganization = async (orgBody) => {
    if (await organizationModel.getOrganizationBySlug(orgBody.slug)) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Slug already taken');
    }
    const organization = await organizationModel.createOrganization(orgBody);
    return organization;
};

/**
 * Query for all organizations
 * @returns {Promise<Array>}
 */
const queryOrganizations = async (filter) => {
    return organizationModel.queryOrganizations(filter);
};

/**
 * Get organization by ID
 * @param {string} id
 * @returns {Promise<Object>}
 */
const getOrganizationById = async (id) => {
    const org = await organizationModel.getOrganizationById(id);
    if (!org) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found');
    }
    return org;
};

/**
 * Update organization status
 * @param {string} id
 * @param {string} status
 * @returns {Promise<Object>}
 */
const updateOrganizationStatus = async (id, status) => {
    const org = await getOrganizationById(id);
    if (!org) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found');
    }
    // Could add valid status check here if not done in validation layer
    const updatedOrg = await organizationModel.updateOrganizationStatus(id, status);
    return updatedOrg;
};

const organizationProfileService = require('./organization_profile.service');

const getOrganizationBySlug = async (slug) => {
    const org = await organizationModel.getOrganizationBySlug(slug);
    if (!org) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found');
    }

    // Fetch full profile details (images, trust score, extra fields)
    const profile = await organizationProfileService.getFullProfile(org.id);

    return {
        ...profile,
        ...org, // Ensure org fields (like id, name) take precedence
        profileId: profile.id
    };
};

module.exports = {
    createOrganization,
    queryOrganizations,
    getOrganizationById,
    getOrganizationBySlug,
    updateOrganizationStatus
};
