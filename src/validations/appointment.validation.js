const Joi = require('joi');

const bookAppointment = {
    body: Joi.object().keys({
        orgId: Joi.string().uuid().required(),
        slotId: Joi.string().uuid().optional(),
        serviceId: Joi.string().uuid().required(),
        resourceId: Joi.string().uuid().optional(),
    }),
};

const cancelAppointment = {
    params: Joi.object().keys({
        appointmentId: Joi.string().uuid().required()
    })
};

const updateStatus = {
    params: Joi.object().keys({
        appointmentId: Joi.string().uuid().required()
    }),
    body: Joi.object().keys({
        status: Joi.string().valid('pending', 'confirmed', 'completed', 'cancelled', 'serving', 'no_show').required()
    })
};

module.exports = {
    bookAppointment,
    cancelAppointment,
    updateStatus
};

