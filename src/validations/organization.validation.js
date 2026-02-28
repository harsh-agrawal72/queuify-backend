const Joi = require('joi');

const createOrganization = {
    body: Joi.object().keys({
        name: Joi.string().required(),
        slug: Joi.string().required(),
        contactEmail: Joi.string().email(),
    }),
};

const getOrganization = {
    params: Joi.object().keys({
        orgId: Joi.string().uuid().required(),
    }),
};

const updateOrganizationStatus = {
    params: Joi.object().keys({
        orgId: Joi.string().uuid().required(),
    }),
    body: Joi.object().keys({
        status: Joi.string().valid('pending', 'active', 'rejected', 'disabled', 'deactivated').required(),
    })
}

module.exports = {
    createOrganization,
    getOrganization,
    updateOrganizationStatus
};
