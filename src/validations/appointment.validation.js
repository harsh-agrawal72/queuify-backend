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
        status: Joi.string().valid('pending', 'confirmed', 'completed', 'cancelled', 'serving', 'no_show').required(),
        admin_remarks: Joi.string().allow('', null).optional()
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

const triggerEmergencyMode = {
    body: Joi.object().keys({
        resourceId: Joi.string().uuid().required(),
        date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required()
    })
};

const verifyOtp = {
    params: Joi.object().keys({
        appointmentId: Joi.string().uuid().required()
    }),
    body: Joi.object().keys({
        otp: Joi.string().length(4).required(),
        remarks: Joi.string().allow('', null).max(1000).optional()
    })
};

module.exports = {
    bookAppointment,
    cancelAppointment,
    updateStatus,
    rescheduleAppointment,
    proposeReschedule,
    respondToReschedule,
    triggerEmergencyMode,
    verifyOtp
};

