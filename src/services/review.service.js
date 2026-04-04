const reviewModel = require('../models/review.model');

/**
 * Get reviews and statistics for an organization
 * @param {string} orgId 
 * @param {number} limit 
 * @param {number} offset 
 * @returns {Promise<Object>}
 */
const getOrgReviews = async (orgId, limit = 20, offset = 0) => {
    const [reviews, stats] = await Promise.all([
        reviewModel.getReviewsByOrgId(orgId, limit, offset),
        reviewModel.getReviewsStatsByOrgId(orgId)
    ]);

    return {
        reviews,
        stats
    };
};

module.exports = {
    getOrgReviews
};
