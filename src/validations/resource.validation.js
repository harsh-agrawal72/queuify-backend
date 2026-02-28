const Joi = require('joi');

const createResource = {
    body: Joi.object().keys({
        name: Joi.string().required(),
        type: Joi.string().valid('staff', 'room', 'equipment', 'counter').default('staff'),
        description: Joi.string().allow('', null),
        concurrent_capacity: Joi.number().integer().min(1).default(1),
        serviceIds: Joi.array().items(Joi.string().uuid()).optional(),
        serviceId: Joi.string().uuid().optional(),
    }),
};

const updateResource = {
    params: Joi.object().keys({
        resourceId: Joi.string().uuid().required(),
    }),
    body: Joi.object().keys({
        name: Joi.string(),
        type: Joi.string().valid('staff', 'room', 'equipment', 'counter'),
        description: Joi.string().allow('', null),
        concurrent_capacity: Joi.number().integer().min(1),
        is_active: Joi.boolean(),
        serviceIds: Joi.array().items(Joi.string().uuid()),
        serviceId: Joi.string().uuid().optional(),
    }).min(1),
};

const getResource = {
    params: Joi.object().keys({
        resourceId: Joi.string().uuid().required(),
    }),
};

const getResourcesByService = {
    params: Joi.object().keys({
        serviceId: Joi.string().uuid().required(),
    }),
};

const deleteResource = {
    params: Joi.object().keys({
        resourceId: Joi.string().uuid().required(),
    }),
};

module.exports = {
    createResource,
    updateResource,
    getResource,
    getResourcesByService,
    deleteResource,
};
