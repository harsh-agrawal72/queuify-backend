const httpStatus = require('../utils/httpStatus');
const ApiError = require('../utils/ApiError');
const { pool } = require('../config/db');

const checkOrgStatus = async (req, res, next) => {
    // Skip for superadmins
    if (req.user && req.user.role === 'superadmin') {
        return next();
    }

    // Get orgId from user (if logged in) or params/query/body
    const orgId = req.user?.org_id || req.params.orgId || req.query.orgId || req.body.orgId;

    if (!orgId) {
        return next(); // Default to proceeding if no org context
    }

    const resDb = await pool.query('SELECT status FROM organizations WHERE id = $1', [orgId]);
    if (resDb.rows.length === 0) {
        return next(new ApiError(httpStatus.NOT_FOUND, 'Organization not found.'));
    }

    const { status } = resDb.rows[0];
    if (status === 'suspended' || status === 'disabled') {
        return next(new ApiError(httpStatus.FORBIDDEN, 'Organization is unavailable. Contact support.'));
    }

    next();
};

module.exports = checkOrgStatus;
