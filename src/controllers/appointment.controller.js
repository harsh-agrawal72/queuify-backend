const httpStatus = require('../utils/httpStatus');
const catchAsync = require('../utils/catchAsync');
const appointmentService = require('../services/appointment.service');


const bookAppointment = catchAsync(async (req, res) => {
    // Add userId from auth token to body
    const appointmentBody = {
        ...req.body,
        userId: req.user.id
    };

    const result = await appointmentService.bookAppointment(appointmentBody);

    // Extract from result wrapper { appointment: {...}, queue_number: ... }
    const { appointment, queue_number } = result;

    // Return explicit success structure with token
    res.status(httpStatus.CREATED).send({
        success: true,
        message: 'Appointment booked successfully',
        appointmentId: appointment.id,
        queueNumber: queue_number,
        slotId: appointment.slot_id,
        status: appointment.status
    });
});

const getAppointments = catchAsync(async (req, res) => {
    const appointments = await appointmentService.getUserAppointments(req.user.id);
    res.send(appointments);
});

const cancelAppointment = catchAsync(async (req, res) => {
    const appointment = await appointmentService.cancelAppointment(req.params.appointmentId, req.user.id);
    res.send(appointment);
});


const updateStatus = catchAsync(async (req, res) => {
    // OrgId must come from somewhere (admin likely operates on their own org??)
    // Or appointmentId implies org.
    // Service updateAppointmentStatus(id, status, orgId) checks orgId.
    // Admin user has org_id.
    const appointment = await appointmentService.updateAppointmentStatus(req.params.appointmentId, req.body.status, req.user.org_id);
    res.send(appointment);
});

module.exports = {
    bookAppointment,
    getAppointments,
    cancelAppointment,
    updateStatus,
    getQueueStatus: catchAsync(async (req, res) => {
        const status = await appointmentService.getQueueStatus(req.params.appointmentId);
        res.send(status);
    })
};

