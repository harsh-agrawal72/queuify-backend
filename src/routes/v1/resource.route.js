const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const resourceValidation = require('../../validations/resource.validation');
const resourceController = require('../../controllers/resource.controller');

const router = express.Router();

router.use(auth('admin'));

router.route('/')
    .post(validate(resourceValidation.createResource), resourceController.createResource)
    .get(resourceController.getResources);

router.route('/by-service/:serviceId')
    .get(validate(resourceValidation.getResourcesByService), resourceController.getResourcesByService);

router.post('/link', resourceController.linkResource);
router.post('/unlink', resourceController.unlinkResource);

router.route('/:resourceId')
    .get(validate(resourceValidation.getResource), resourceController.getResource)
    .patch(validate(resourceValidation.updateResource), resourceController.updateResource)
    .delete(validate(resourceValidation.deleteResource), resourceController.deleteResource);

module.exports = router;
