const httpStatus = require('../utils/httpStatus');
const catchAsync = require('../utils/catchAsync');
const { planService } = require('../services');

const createPlan = catchAsync(async (req, res) => {
    const plan = await planService.createPlan(req.body);
    res.status(httpStatus.CREATED).send(plan);
});

const getPlans = catchAsync(async (req, res) => {
    const { target_role } = req.query;
    const plans = await planService.getPlans(target_role);
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

const assignUserPlan = catchAsync(async (req, res) => {
    const result = await planService.assignPlanToUser(req.user.id, req.body.planId);
    res.send(result);
});

const forceUpdateV3 = catchAsync(async (req, res) => {
    const { pool } = require('../config/db');
    
    const plans = [
        {
            name: 'Free',
            price_monthly: 0,
            price_yearly: 0,
            commission_rate: 10.0,
            features: {
                max_resources: 1,
                max_admins: 1,
                analytics: 'basic',
                has_basic_features: true,
                has_custom_branding: false,
                has_top_position: false,
                has_one_on_one_support: false,
                has_customer_insight: false,
                has_premium_features: false
            }
        },
        {
            name: 'Starter',
            price_monthly: 699,
            price_yearly: 6990,
            commission_rate: 8.0,
            features: {
                max_resources: 2,
                max_admins: 1,
                analytics: 'basic',
                has_basic_features: true,
                has_custom_branding: false,
                has_top_position: false,
                has_one_on_one_support: false,
                has_customer_insight: false,
                has_premium_features: false
            }
        },
        {
            name: 'Professional',
            price_monthly: 999,
            price_yearly: 9990,
            commission_rate: 5.0,
            features: {
                max_resources: 5,
                max_admins: 2,
                analytics: 'advanced',
                has_basic_features: true,
                has_custom_branding: true,
                has_top_position: false,
                has_one_on_one_support: false,
                has_customer_insight: false,
                has_premium_features: true
            }
        },
        {
            name: 'Enterprise',
            price_monthly: 1499,
            price_yearly: 14990,
            commission_rate: 2.0,
            features: {
                max_resources: 20,
                max_admins: 5,
                analytics: 'advanced',
                has_basic_features: true,
                has_custom_branding: true,
                has_top_position: true,
                has_one_on_one_support: true,
                has_customer_insight: true,
                has_premium_features: true
            }
        }
    ];

    for (const p of plans) {
        await pool.query(
            `INSERT INTO plans (name, price_monthly, price_yearly, commission_rate, features, target_role)
             VALUES ($1, $2, $3, $4, $5, 'admin')
             ON CONFLICT (name) DO UPDATE SET 
                price_monthly = EXCLUDED.price_monthly,
                price_yearly = EXCLUDED.price_yearly,
                commission_rate = EXCLUDED.commission_rate,
                features = EXCLUDED.features`,
            [p.name, p.price_monthly, p.price_yearly, p.commission_rate, JSON.stringify(p.features)]
        );
    }

    res.send({ message: "Admin plans updated successfully to V3! Please refresh your dashboard now." });
});

module.exports = {
    createPlan,
    getPlans,
    getPlan,
    updatePlan,
    deletePlan,
    assignUserPlan,
    forceUpdateV3
};
