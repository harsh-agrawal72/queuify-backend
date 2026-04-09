const organizationProfileModel = require('../models/organization_profile.model');
const organizationImageModel = require('../models/organization_image.model');
const organizationModel = require('../models/organization.model');
const { pool } = require('../config/db');

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
    // 🚀 Parallel fetch to eliminate sequential wait times
    const [org, profileResult, rawImages] = await Promise.all([
        organizationModel.getOrganizationById(orgId),
        organizationProfileModel.getProfileByOrgId(orgId),
        organizationImageModel.getImagesByOrgId(orgId)
    ]);

    const profile = profileResult || {};
    const trustScore = calculateTrustScore(profile, rawImages);

    // Transform image URLs
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
        images,
        trustScore,
        isVerified: trustScore >= 80 || profile.verified,
        email_verified: org?.email_verified || false,
        org_is_setup_completed: org?.org_is_setup_completed || false
    };
};

/**
 * Update organization profile
 */
const updateProfile = async (orgId, profileData) => {
    const profile = await organizationProfileModel.upsertProfile(orgId, profileData);
    await syncSetupStatus(orgId);
    return profile;
};

/**
 * Sync setup status in organizations table based on mandatory fields
 */
const syncSetupStatus = async (orgId) => {
    const profile = await organizationProfileModel.getProfileByOrgId(orgId) || {};
    const images = await organizationImageModel.getImagesByOrgId(orgId);
    
    const isComplete = !!(
        profile.description && 
        profile.keywords && 
        profile.contact_phone && 
        profile.address && 
        profile.city && 
        profile.state && 
        profile.pincode &&
        images.some(img => img.image_type === 'pan_card') &&
        images.some(img => img.image_type === 'aadhar_card')
    );

    await organizationModel.updateSetupStatus(orgId, isComplete);
    
    // Auto-onboard if setup is finished
    if (isComplete) {
        await pool.query('UPDATE organizations SET is_onboarded = TRUE WHERE id = $1', [orgId]);
    }

    return isComplete;
};

module.exports = {
    getFullProfile,
    updateProfile,
    calculateTrustScore,
    syncSetupStatus
};
