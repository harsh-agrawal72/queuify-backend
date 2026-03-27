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
        try {
            const status = await appointmentService.getQueueStatus(req.params.appointmentId);
            res.send(status);
        } catch (error) {
            console.error(`[Controller-getQueueStatus] Error for ID ${req.params.appointmentId}:`, error);
            // Pass to global error handler but log locally first
            throw error;
        }
    }),
    rescheduleAppointment: catchAsync(async (req, res) => {
        const isAdmin = req.user.role === 'admin';
        const orgId = isAdmin ? req.user.org_id : null;
        
        const result = await appointmentService.rescheduleAppointment(
            req.params.appointmentId,
            req.user.id,
            req.body.newSlotId,
            isAdmin,
            orgId
        );
        res.send({
            success: true,
            message: 'Appointment rescheduled successfully',
            appointment: result.appointment,
            queueNumber: result.queue_number
        });
    }),
    proposeReschedule: catchAsync(async (req, res) => {
        const { newSlotId, reason } = req.body;
        const appointment = await appointmentService.proposeReschedule(
            req.params.appointmentId,
            req.user.org_id,
            newSlotId,
            reason
        );
        res.send({
            success: true,
            message: 'Reschedule proposed successfully',
            appointment
        });
    }),
    respondToReschedule: catchAsync(async (req, res) => {
        const { action } = req.body;
        const result = await appointmentService.respondToReschedule(
            req.params.appointmentId,
            req.user.id,
            action
        );
        res.send({
            success: true,
            message: `Proposal ${action}ed successfully`,
            result
        });
    })
};

