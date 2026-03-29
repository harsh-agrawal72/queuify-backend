const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const appointmentValidation = require('../../validations/appointment.validation');

const appointmentController = require('../../controllers/appointment.controller');

const router = express.Router();

const checkOrgStatus = require('../../middlewares/checkOrgStatus');

router.get('/my', auth('user'), appointmentController.getAppointments);

router
    .route('/')
    .post(auth('user'), checkOrgStatus, validate(appointmentValidation.bookAppointment), appointmentController.bookAppointment)
    .get(auth('user'), appointmentController.getAppointments);

router
    .route('/:appointmentId/cancel')
    .post(auth('user'), validate(appointmentValidation.cancelAppointment), appointmentController.cancelAppointment); // Using POST as it's an action, or could use PATCH/DELETE

router
    .route('/:appointmentId/status')
    .patch(auth('admin'), validate(appointmentValidation.updateStatus), appointmentController.updateStatus);

router
    .route('/:appointmentId/reschedule')
    .patch(auth('user', 'admin'), validate(appointmentValidation.rescheduleAppointment), appointmentController.rescheduleAppointment);

router
    .route('/:appointmentId/propose-reschedule')
    .patch(auth('admin'), validate(appointmentValidation.proposeReschedule), appointmentController.proposeReschedule);

router
    .route('/:appointmentId/respond-reschedule')
    .patch(auth('user'), validate(appointmentValidation.respondToReschedule), appointmentController.respondToReschedule);

router.post('/emergency-mode', auth('admin'), validate(appointmentValidation.triggerEmergencyMode), appointmentController.triggerEmergencyMode);

router.post('/:appointmentId/verify-otp', auth('admin'), validate({
    body: require('joi').object().keys({
        otp: require('joi').string().length(4).required()
    })
}), appointmentController.verifyOtp);

router.get('/:appointmentId/queue', auth(), appointmentController.getQueueStatus);


router.get('/debug/slot-queues', async (req, res) => {
    try {
        const result = await require('../../models/appointment.model').pool.query(
            `SELECT slot_id, queue_number, created_at, status,
                    ROW_NUMBER() OVER (PARTITION BY slot_id ORDER BY created_at ASC) as calculated_queue
             FROM appointments 
             WHERE status IN ('pending', 'confirmed', 'completed')
             ORDER BY created_at DESC LIMIT 20`
        );
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/:appointmentId/arrive', auth('user'), appointmentController.markArrived);
router.post('/:appointmentId/dispute', auth('user'), validate({
    body: require('joi').object().keys({
        reason: require('joi').string().required().max(500)
    })
}), appointmentController.flagDispute);

module.exports = router;
