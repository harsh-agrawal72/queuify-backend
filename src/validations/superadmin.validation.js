const Joi = require('joi');

const createOrganization = {
    body: Joi.object().keys({
        name: Joi.string().required(),
        slug: Joi.string().required(),
        contact_email: Joi.string().email().required(),
        plan_id: Joi.string().uuid().optional().allow('', null),
        admin_name: Joi.string().required(),
        admin_email: Joi.string().email().required(),
        type: Joi.string().valid('Clinic', 'Hospital', 'Salon', 'Bank', 'Government Office', 'Consultancy', 'Coaching Institute', 'Service Center', 'Other'),
    }),
};

const updateOrganization = {
    params: Joi.object().keys({
        orgId: Joi.string().uuid().required(),
    }),
    body: Joi.object().keys({
        name: Joi.string(),
        slug: Joi.string(),
        contact_email: Joi.string().email(),
        status: Joi.string().valid('active', 'disabled', 'pending', 'deactivated'),
        plan_id: Joi.string().uuid().optional().allow('', null),
        subscription_status: Joi.string().optional(),
        type: Joi.string().valid('Clinic', 'Hospital', 'Salon', 'Bank', 'Government Office', 'Consultancy', 'Coaching Institute', 'Service Center', 'Other'),
    }).min(1),
};

const inviteAdmin = {
    body: Joi.object().keys({
        email: Joi.string().email().required(),
        orgId: Joi.string().uuid().required(),
        name: Joi.string().required(),
    }),
};

module.exports = {
    createOrganization,
    updateOrganization,
    inviteAdmin,
};
