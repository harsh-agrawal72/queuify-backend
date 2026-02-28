const Joi = require('joi');

const createSlot = {
    body: Joi.object().keys({
        start_time: Joi.date().iso().required(),
        // end_time is calculated in service usually, but if provided:
        end_time: Joi.date().iso().optional(),
        resource_id: Joi.string().uuid().required(),
        service_id: Joi.string().uuid().optional(),
        max_capacity: Joi.number().integer().min(1).optional(),
        // Backwards compatibility for camelCase if needed, but preference is snake_case
        startTime: Joi.date().iso().optional(),
        resourceId: Joi.string().uuid().optional(),
        serviceId: Joi.string().uuid().optional(),
        maxCapacity: Joi.number().integer().min(1).optional(),
    }),
};

const getSlots = {
    query: Joi.object().keys({
        resource_id: Joi.string().uuid(),
        service_id: Joi.string().uuid(),
        resourceId: Joi.string().uuid(), // keep for compat
        serviceId: Joi.string().uuid(),
        date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/),
    }),
};

module.exports = {
    createSlot,
    getSlots,
};
