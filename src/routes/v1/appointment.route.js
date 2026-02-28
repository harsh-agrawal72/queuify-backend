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

module.exports = router;
