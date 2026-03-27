const Joi = require('joi');

const bookAppointment = {
    body: Joi.object().keys({
        orgId: Joi.string().uuid().required(),
        slotId: Joi.string().uuid().optional(),
        serviceId: Joi.string().uuid().required(),
        resourceId: Joi.string().uuid().optional(),
        pref_resource: Joi.string().valid('ANY', 'SPECIFIC').optional(),
        pref_time: Joi.string().valid('URGENT', 'FLEXIBLE').optional(),
        bypassDuplicate: Joi.boolean().optional(),
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

const rescheduleAppointment = {
    params: Joi.object().keys({
        appointmentId: Joi.string().uuid().required()
    }),
    body: Joi.object().keys({
        newSlotId: Joi.string().uuid().required()
    })
};

const proposeReschedule = {
    params: Joi.object().keys({
        appointmentId: Joi.string().uuid().required()
    }),
    body: Joi.object().keys({
        newSlotId: Joi.string().uuid().required(),
        reason: Joi.string().required().min(5).max(500)
    })
};

const respondToReschedule = {
    params: Joi.object().keys({
        appointmentId: Joi.string().uuid().required()
    }),
    body: Joi.object().keys({
        action: Joi.string().valid('accept', 'decline').required()
    })
};

module.exports = {
    bookAppointment,
    cancelAppointment,
    updateStatus,
    rescheduleAppointment,
    proposeReschedule,
    respondToReschedule
};

