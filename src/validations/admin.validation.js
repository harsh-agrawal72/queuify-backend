const Joi = require('joi');

const createSlot = {
    body: Joi.object().keys({
        start_time: Joi.date().iso().required().description('ISO Date string'),
        end_time: Joi.date().iso().required().description('ISO Date string'),
        max_capacity: Joi.number().integer().min(1).required(),
        resource_id: Joi.string().guid().optional(), // Optional for now to support legacy, but should be required eventually
    }),
};

const updateSlot = {
    params: Joi.object().keys({
        slotId: Joi.string().uuid().required(),
    }),
    body: Joi.object().keys({
        start_time: Joi.date().iso(),
        end_time: Joi.date().iso(),
        max_capacity: Joi.number().integer().min(1),
        resource_id: Joi.string().uuid().optional(),
        service_id: Joi.string().uuid().optional(),
    }).min(1),
};

const deleteSlot = {
    params: Joi.object().keys({
        slotId: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
    }),
};

const updateAppointmentStatus = {
    params: Joi.object().keys({
        appointmentId: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
    }),
    body: Joi.object().keys({
        status: Joi.string().valid('pending', 'confirmed', 'completed', 'cancelled', 'serving', 'no_show').required(),
    }),
};

const deleteAppointment = {
    params: Joi.object().keys({
        appointmentId: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
    }),
};

module.exports = {
    createSlot,
    updateSlot,
    deleteSlot,
    updateAppointmentStatus,
    deleteAppointment,
};
