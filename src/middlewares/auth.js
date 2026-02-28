const jwt = require('jsonwebtoken');
const httpStatus = require('../utils/httpStatus');
const config = require('../config/config');
const ApiError = require('../utils/ApiError');
const { getUserById } = require('../models/user.model');

const verifyCallback = (req, resolve, reject, requiredRoles) => async (err, decoded) => {
    if (err || !decoded) {
        return reject(new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate'));
    }
    const user = await getUserById(decoded.sub);

    if (!user) {
        return reject(new ApiError(httpStatus.UNAUTHORIZED, 'User not found'));
    }

    req.user = user;

    if (requiredRoles.length && !requiredRoles.includes(user.role)) {
        return reject(new ApiError(httpStatus.FORBIDDEN, 'Forbidden'));
    }

    resolve();
};

const auth = (...requiredRoles) => async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate'));
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, config.jwt.secret);
        await new Promise((resolve, reject) => {
            verifyCallback(req, resolve, reject, requiredRoles)(null, decoded);
        });
        next();
    } catch (err) {
        next(new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate'));
    }
};

module.exports = auth;
