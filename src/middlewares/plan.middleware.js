const httpStatus = require('../utils/httpStatus');
const ApiError = require('../utils/ApiError');
const { pool } = require('../config/db');

/**
 * Middleware to check if a user's plan supports a specific feature or limit
 * @param {string} featureName - The name of the feature or limit to check
 * @param {number} currentCount - (Optional) Current usage count to check against limit
 */
const checkUserPlanFeature = (featureName, currentCount = null) => {
    return async (req, res, next) => {
        try {
            // 1. Fetch user with their plan features
            const userRes = await pool.query(
                `SELECT u.id, p.features 
                 FROM users u
                 JOIN plans p ON u.plan_id = p.id
                 WHERE u.id = $1`,
                [req.user.id]
            );

            if (userRes.rows.length === 0) {
                return next(new ApiError(httpStatus.NOT_FOUND, 'User or plan not found'));
            }

            const features = userRes.rows[0].features || {};
            
            // 2. Check logic based on featureName
            switch (featureName) {
                case 'max_active_appointments':
                    const limit = features.max_active_appointments || 2;
                    if (currentCount !== null && currentCount >= limit) {
                        return next(new ApiError(httpStatus.FORBIDDEN, `Your current plan allows only ${limit} active appointments. Please upgrade for more.`));
                    }
                    break;
                
                case 'priority_booking':
                    if (features.priority !== true) {
                        return next(new ApiError(httpStatus.FORBIDDEN, 'Priority booking is only available for Premium users.'));
                    }
                    break;

                case 'sms_notifications':
                    if (!features.notifications || !features.notifications.includes('sms')) {
                        return next(new ApiError(httpStatus.FORBIDDEN, 'SMS notifications are only available for Premium users.'));
                    }
                    break;

                default:
                    // Generic boolean check
                    if (features[featureName] === false) {
                        return next(new ApiError(httpStatus.FORBIDDEN, 'Feature not included in your current plan.'));
                    }
            }

            next();
        } catch (error) {
            next(error);
        }
    };
};

module.exports = {
    checkUserPlanFeature,
};
