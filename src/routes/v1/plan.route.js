const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const planController = require('../../controllers/plan.controller');

const { optionalAuth } = require('../../middlewares/auth');

const router = express.Router();

router.get('/', optionalAuth, planController.getPlans);
router.get('/force-update-v3', planController.forceUpdateV3);
router.get('/sync-user-plans', planController.syncUserPlans);
router.post('/assign', auth('user'), planController.assignUserPlan);

router.use(auth('superadmin'));

router.post('/', planController.createPlan);

router
    .route('/:planId')
    .get(planController.getPlan)
    .patch(planController.updatePlan)
    .delete(planController.deletePlan);

module.exports = router;
