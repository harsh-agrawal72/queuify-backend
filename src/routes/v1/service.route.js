const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const serviceController = require('../../controllers/service.controller');
const serviceValidation = require('../../validations/service.validation');

const router = express.Router();

router.use(auth('admin')); // All service routes require admin

router.route('/')
    .post(validate(serviceValidation.createService), serviceController.createService)
    .get(validate(serviceValidation.getServices), serviceController.getServices);

router.route('/:serviceId')
    .get(validate(serviceValidation.getService), serviceController.getService)
    .patch(validate(serviceValidation.updateService), serviceController.updateService)
    .delete(validate(serviceValidation.deleteService), serviceController.deleteService);

module.exports = router;
