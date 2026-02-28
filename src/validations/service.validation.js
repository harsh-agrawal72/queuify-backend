const Joi = require('joi');

const createService = {
    body: Joi.object().keys({
        name: Joi.string().required(),
        description: Joi.string().allow('', null),
        queue_scope: Joi.string().valid('CENTRAL', 'PER_RESOURCE').default('CENTRAL'),
        estimated_service_time: Joi.number().integer().min(1).default(30),
    }),
};

const getServices = {
    query: Joi.object().keys({
        name: Joi.string(),
        sortBy: Joi.string(),
        limit: Joi.number().integer(),
        page: Joi.number().integer(),
    }),
};

const getService = {
    params: Joi.object().keys({
        serviceId: Joi.string().uuid().required(),
    }),
};

const updateService = {
    params: Joi.object().keys({
        serviceId: Joi.string().uuid().required(),
    }),
    body: Joi.object().keys({
        name: Joi.string(),
        description: Joi.string().allow('', null),
        is_active: Joi.boolean(),
        queue_scope: Joi.string().valid('CENTRAL', 'PER_RESOURCE'),
        estimated_service_time: Joi.number().integer().min(1),
    }).min(1),
};

const deleteService = {
    params: Joi.object().keys({
        serviceId: Joi.string().uuid().required(),
    }),
};

module.exports = {
    createService,
    getServices,
    getService,
    updateService,
    deleteService,
};
