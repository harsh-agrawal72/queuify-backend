const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const planController = require('../../controllers/plan.controller');

const router = express.Router();

router.get('/', planController.getPlans);

router.use(auth('superadmin'));

router.post('/', planController.createPlan);

router
    .route('/:planId')
    .get(planController.getPlan)
    .patch(planController.updatePlan)
    .delete(planController.deletePlan);

module.exports = router;
