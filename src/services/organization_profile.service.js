const organizationProfileModel = require('../models/organization_profile.model');
const organizationImageModel = require('../models/organization_image.model');

/**
 * Calculate profile completion percentage (Trust Score)
 */
const calculateTrustScore = (profile, images) => {
    let score = 0;

    if (!profile) return 0;

    // Basic Info (20%)
    if (profile.description) score += 10;
    if (profile.established_year || profile.total_staff) score += 10;

    // Contact & Location (25%)
    if (profile.address && profile.city && profile.pincode) score += 15;
    if (profile.contact_email || profile.contact_phone) score += 10;

    // Media (30%)
    const hasLogo = images.some(img => img.image_type === 'logo');
    const hasCover = images.some(img => img.image_type === 'cover');
    const hasGallery = images.some(img => img.image_type === 'gallery');

    if (hasLogo) score += 10;
    if (hasCover) score += 10;
    if (hasGallery) score += 10;

    // Social Links (15%)
    let socialCount = 0;
    if (profile.facebook_url) socialCount++;
    if (profile.instagram_url) socialCount++;
    if (profile.linkedin_url || profile.website_url) socialCount++;
    score += Math.min(socialCount * 5, 15);

    // Verification Docs (10%)
    if (profile.registration_number || profile.gst_number) score += 10;

    return score;
};

const config = require('../config/config');

/**
 * Get full organization profile with images and trust score
 */
const getFullProfile = async (orgId) => {
    const profile = await organizationProfileModel.getProfileByOrgId(orgId) || {};
    const rawImages = await organizationImageModel.getImagesByOrgId(orgId);
    const trustScore = calculateTrustScore(profile, rawImages);

    // Transform image URLs
    const images = rawImages.map(img => {
        let finalUrl = img.image_url;

        // If no image_url, it's a binary image in the DB
        if (!finalUrl && img.id) {
            finalUrl = `/v1/organizations/image/${img.id}`;
        }

        if (finalUrl && !finalUrl.startsWith('http')) {
            finalUrl = `${config.baseUrl}${finalUrl}`;
        }

        return {
            ...img,
            image_url: finalUrl
        };
    });

    return {
        ...profile,
        images,
        trustScore,
        isVerified: trustScore >= 80 || profile.verified
    };
};

/**
 * Update organization profile
 */
const updateProfile = async (orgId, profileData) => {
    return organizationProfileModel.upsertProfile(orgId, profileData);
};

module.exports = {
    getFullProfile,
    updateProfile,
    calculateTrustScore
};
