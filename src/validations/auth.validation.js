const Joi = require('joi');
const { password } = require('./custom.validation');

const register = {
    body: Joi.object().keys({
        name: Joi.string().required(),
        email: Joi.string().required().email(),
        password: Joi.string().required().custom(password),
        role: Joi.string().valid('user', 'admin').default('user'),
        orgName: Joi.string().when('role', {
            is: 'admin',
            then: Joi.string().required(),
            otherwise: Joi.string().optional().allow('', null),
        }),
        orgId: Joi.string().uuid().when('role', {
            is: 'user',
            then: Joi.string().uuid().optional().allow('', null),
            otherwise: Joi.string().optional().allow('', null),
        }),
    }),
};

const login = {
    body: Joi.object().keys({
        email: Joi.string().required().email(),
        password: Joi.string().required(),
    }),
};

const createOrgAdmin = {
    body: Joi.object().keys({
        name: Joi.string().required(),
        email: Joi.string().required().email(),
        password: Joi.string().required().custom(password),
        orgId: Joi.string().uuid().required(),
    }),
};

const googleLogin = {
    body: Joi.object().keys({
        token: Joi.string().required(),
    }),
};

const registerOrg = {
    body: Joi.object().keys({
        orgName: Joi.string().required(),
        orgEmail: Joi.string().required().email(),
        orgPhone: Joi.string().required().pattern(/^[0-9]{10}$/).messages({
            'string.pattern.base': 'Phone number must be exactly 10 digits.'
        }),
        orgAddress: Joi.string().required(),
        plan: Joi.string().valid('basic', 'pro', 'enterprise').default('basic'),
        adminName: Joi.string().required(),
        adminEmail: Joi.string().required().email(),
        password: Joi.string().required().custom(password),
        type: Joi.string().valid('Clinic', 'Hospital', 'Salon', 'Bank', 'Government Office', 'Consultancy', 'Coaching Institute', 'Service Center', 'Other').required(),
    }),
};

const setPassword = {
    body: Joi.object().keys({
        token: Joi.string().required(),
        newPassword: Joi.string().required().custom(password),
    }),
};

const resetPassword = {
    body: Joi.object().keys({
        token: Joi.string().required(),
        password: Joi.string().required().custom(password),
    }),
};

const forgotPassword = {
    body: Joi.object().keys({
        email: Joi.string().email().required(),
    }),
};

module.exports = {
    register,
    login,
    createOrgAdmin,
    googleLogin,
    registerOrg,
    setPassword,
    forgotPassword,
    resetPassword,
};
