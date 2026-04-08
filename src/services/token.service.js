const jwt = require('jsonwebtoken');

const config = require('../config/config');

/**
 * Generate token
 * @param {string} userId
 * @param {string} role
 * @param {string} orgId
 * @param {string|number} expiresIn - e.g. '1d', '7d', or seconds
 * @param {string} secret
 * @param {Object} extraClaims
 * @returns {string}
 */
const generateToken = (userId, role, orgId, expiresIn = `${config.jwt.accessExpirationMinutes}m`, secret = config.jwt.secret, extraClaims = {}) => {
    const payload = {
        sub: userId,
        role,
        org_id: orgId,
        iat: Math.floor(Date.now() / 1000),
        ...extraClaims
    };
    return jwt.sign(payload, secret, { expiresIn });
};

/**
 * Generate auth tokens
 * @param {Object} user
 * @returns {Promise<Object>}
 */
const generateAuthTokens = async (user, extraClaims = {}) => {
    const accessToken = generateToken(user.id, user.role, user.org_id, `${config.jwt.accessExpirationMinutes}m`, config.jwt.secret, extraClaims);

    return {
        access: {
            token: accessToken,
            expires: new Date(Date.now() + (config.jwt.accessExpirationMinutes * 60 * 1000)),
        },
    };
};

/**
 * Generate reset password token
 * @param {string} email
 * @returns {Promise<string>}
 */
const generateResetPasswordToken = async (email) => {
    const expires = '1h';
    const resetPasswordToken = generateToken(null, null, null, expires, config.jwt.secret, { email, type: 'resetPassword' });
    return resetPasswordToken;
};

/**
 * Verify token and return payload
 * @param {string} token
 * @param {string} type
 * @returns {Promise<Object>}
 */
const verifyToken = async (token, type) => {
    const payload = jwt.verify(token, config.jwt.secret);
    if (type && payload.type !== type) {
        throw new Error(`Token type mismatch. Expected ${type}, got ${payload.type}`);
    }
    return payload;
};

module.exports = {
    generateToken,
    generateAuthTokens,
    verifyToken,
    generateResetPasswordToken,
};
