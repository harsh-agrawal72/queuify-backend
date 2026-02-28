const httpStatus = require('../utils/httpStatus');
const catchAsync = require('../utils/catchAsync');
const { planService } = require('../services');

const createPlan = catchAsync(async (req, res) => {
    const plan = await planService.createPlan(req.body);
    res.status(httpStatus.CREATED).send(plan);
});

const getPlans = catchAsync(async (req, res) => {
    const plans = await planService.getPlans();
    res.send(plans);
});

const getPlan = catchAsync(async (req, res) => {
    const plan = await planService.getPlanById(req.params.planId);
    if (!plan) {
        res.status(httpStatus.NOT_FOUND).send({ message: 'Plan not found' });
    } else {
        res.send(plan);
    }
});

const updatePlan = catchAsync(async (req, res) => {
    const plan = await planService.updatePlan(req.params.planId, req.body);
    res.send(plan);
});

const deletePlan = catchAsync(async (req, res) => {
    await planService.deletePlan(req.params.planId);
    res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
    createPlan,
    getPlans,
    getPlan,
    updatePlan,
    deletePlan
};
