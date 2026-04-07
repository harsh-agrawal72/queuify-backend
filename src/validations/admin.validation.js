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
        status: Joi.string().valid('pending', 'confirmed', 'completed', 'cancelled', 'serving', 'no_show').optional(),
        slotId: Joi.string().uuid().optional(),
        reason: Joi.string().optional().allow('', null),
        admin_remarks: Joi.string().optional().allow('', null),
    }).min(1),
};

const deleteAppointment = {
    params: Joi.object().keys({
        appointmentId: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
    }),
    body: Joi.object().keys({
        reason: Joi.string().optional().allow('', null),
    }),
};

const inviteAdmin = {
    body: Joi.object().keys({
        email: Joi.string().email().required(),
        name: Joi.string().required(),
    }),
};

const deleteAdmin = {
    params: Joi.object().keys({
        adminId: Joi.string().uuid().required(),
    }),
};

const createManualAppointment = {
    body: Joi.object().keys({
        customer_name: Joi.string().required(),
        customer_phone: Joi.string().optional().allow('', null),
        serviceId: Joi.string().uuid().required(),
        resourceId: Joi.string().uuid().required(),
        slotId: Joi.string().uuid().allow('', null).optional(),
        status: Joi.string().valid('pending', 'confirmed', 'completed', 'cancelled', 'serving', 'no_show').optional(),
        preferredDate: Joi.date().iso().optional(),
    }),
};

const updateOrgDetails = {
    body: Joi.object().keys({
        name: Joi.string().optional(),
        contactEmail: Joi.string().email().optional(),
        phone: Joi.string().optional(),
        address: Joi.string().optional(),
        openTime: Joi.string().optional(),
        closeTime: Joi.string().optional(),
        queue_mode_default: Joi.string().valid('CENTRAL', 'PER_RESOURCE').optional(),
        email_notification: Joi.boolean().optional(),
        new_booking_notification: Joi.boolean().optional(),
        payout_bank_name: Joi.string().allow('', null).optional(),
        payout_account_holder: Joi.string().allow('', null).optional(),
        payout_account_number: Joi.string().allow('', null).optional(),
        payout_ifsc: Joi.string().allow('', null).optional(),
        payout_upi_id: Joi.string().allow('', null).optional(),
    }).min(1),
};

module.exports = {
    createSlot,
    updateSlot,
    deleteSlot,
    updateAppointmentStatus,
    deleteAppointment,
    inviteAdmin,
    deleteAdmin,
    createManualAppointment,
    updateOrgDetails,
};
