const httpStatus = require('../utils/httpStatus');
const organizationModel = require('../models/organization.model');
const { pool } = require('../config/db');
const ApiError = require('../utils/ApiError');
const organizationProfileModel = require('../models/organization_profile.model');
const organizationImageModel = require('../models/organization_image.model');
const organizationProfileService = require('./organization_profile.service');

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

const tokenService = require('./token.service');
const emailService = require('./email.service');

/**
 * Request email verification
 * @param {string} orgId
 * @returns {Promise}
 */
const requestEmailVerification = async (orgId) => {
    const org = await getOrganizationById(orgId);
    if (!org.contact_email) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Organization has no contact email set');
    }

    const verificationToken = tokenService.generateToken(
        null, // No user sub
        'admin', // Admin role required to verify
        orgId,
        '24h',
        undefined,
        { type: 'verifyOrgEmail', orgId }
    );

    await emailService.sendOrgVerificationEmail(org.contact_email, verificationToken);
};

/**
 * Verify organization email
 * @param {string} token
 * @returns {Promise<Object>}
 */
const verifyEmail = async (token) => {
    try {
        const payload = await tokenService.verifyToken(token, 'verifyOrgEmail');
        const { orgId } = payload;

        await pool.query(
            'UPDATE organizations SET email_verified = TRUE WHERE id = $1',
            [orgId]
        );

        return { message: 'Email verified successfully', orgId };
    } catch (error) {
        throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid or expired verification token');
    }
};

const reviewService = require('./review.service');
const serviceService = require('./service.service');

const getPublicProfileBySlug = async (slug, userId = null) => {
    // 1. First, get the core organization record to obtain the ID
    const org = await organizationModel.getOrganizationBySlug(slug);
    if (!org) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found');
    }

    const orgId = org.id;

    // 2. Parallelized fetch for all related data to eliminate sequential wait times
    // This is the fastest way to get the full profile in a single blast
    const [profileResult, rawImages, services, reviewsData, favoriteStatus] = await Promise.all([
        organizationProfileModel.getProfileByOrgId(orgId).catch(() => ({})),
        organizationImageModel.getImagesByOrgId(orgId).catch(() => []),
        pool.query('SELECT * FROM services WHERE org_id = $1 AND is_active = true ORDER BY created_at DESC', [orgId]).then(r => r.rows).catch(() => []),
        reviewService.getOrgReviews(orgId).catch(() => ({ reviews: [], stats: { totalReviews: 0, averageRating: 0 } })),
        userId ? pool.query('SELECT 1 FROM user_favorites WHERE user_id = $1 AND org_id = $2', [userId, orgId]).then(r => r.rows.length > 0).catch(() => false) : Promise.resolve(false)
    ]);

    // 3. Process data (Calculate Trust Score & Transform Images)
    const profile = profileResult || {};
    const trustScore = organizationProfileService.calculateTrustScore(profile, rawImages);

    // Transform image URLs with base URL prefixing where needed
    const config = require('../config/config');
    const images = rawImages.map(img => {
        let finalUrl = img.image_url;
        if (!finalUrl && img.id) {
            finalUrl = `/v1/organizations/image/${img.id}`;
        }
        if (finalUrl && !finalUrl.startsWith('http')) {
            finalUrl = `${config.baseUrl}${finalUrl}`;
        }
        return { ...img, image_url: finalUrl };
    });

    return {
        ...profile,
        ...org, // Org ID and fields win
        images,
        services,
        trustScore,
        isVerified: trustScore >= 80 || profile.verified,
        reviews_stats: reviewsData.stats,
        recent_reviews: (reviewsData.reviews || []).slice(0, 5),
        is_favorite: favoriteStatus,
        email_verified: org.email_verified || false,
        org_is_setup_completed: org.org_is_setup_completed || false,
        avg_rating: (reviewsData.stats && reviewsData.stats.averageRating) || 0,
        total_reviews: (reviewsData.stats && reviewsData.stats.totalReviews) || 0
    };
};

module.exports = {
    createOrganization,
    queryOrganizations,
    getOrganizationById,
    getOrganizationBySlug,
    updateOrganizationStatus,
    requestEmailVerification,
    verifyEmail,
    getPublicProfileBySlug
};
