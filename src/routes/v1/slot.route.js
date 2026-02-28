const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const slotValidation = require('../../validations/slot.validation');
const slotController = require('../../controllers/slot.controller');

const checkOrgStatus = require('../../middlewares/checkOrgStatus');

const router = express.Router();

router
    .route('/')
    .post(auth('admin'), checkOrgStatus, validate(slotValidation.createSlot), slotController.createSlot)
    .get(auth('admin', 'user', 'superadmin'), validate(slotValidation.getSlots), slotController.getSlots);

router
    .route('/:slotId')
    .delete(auth('admin'), checkOrgStatus, slotController.deleteSlot);

router
    .route('/available/:orgId')
    .get(auth('user', 'admin'), checkOrgStatus, slotController.getAvailableSlots);

module.exports = router;
