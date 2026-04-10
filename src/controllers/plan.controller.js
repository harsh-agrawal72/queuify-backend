const httpStatus = require('../utils/httpStatus');
const catchAsync = require('../utils/catchAsync');
const { planService } = require('../services');

const createPlan = catchAsync(async (req, res) => {
    const plan = await planService.createPlan(req.body);
    res.status(httpStatus.CREATED).send(plan);
});

/**
 * Defensive Hydration: Returns hardcoded feature defaults based on Plan Name
 * This ensures frontend cards show the correct features even if DB is outdated.
 */
const getPlanHardDefaults = (planName) => {
    const pName = (planName || 'Free').toLowerCase();
    
    // Default empty set
    const features = {};

    // 1. Branding (Starter and above)
    if (['starter', 'professional', 'enterprise'].includes(pName)) {
        features.has_custom_branding = true;
    }

    // 2. Gallery & History (Professional and above)
    if (['professional', 'enterprise'].includes(pName)) {
        features.has_gallery_upload = true;
        features.has_patient_history = true;
    }

    return features;
};

const getPlans = catchAsync(async (req, res) => {
    const { target_role } = req.query;
    // Superadmins can see all plans (including inactive ones)
    const includeInactive = req.user && req.user.role === 'superadmin';
    const plans = await planService.getPlans(target_role, includeInactive);
    
    // Defensive Hydration for the list
    const hydratedPlans = plans.map(p => {
        const dbFeatures = typeof p.features === 'string' ? JSON.parse(p.features) : (p.features || {});
        const hardDefaults = getPlanHardDefaults(p.name);
        
        return {
            ...p,
            features: {
                ...dbFeatures,
                ...hardDefaults
            }
        };
    });
    
    res.send(hydratedPlans);
});

const getPlan = catchAsync(async (req, res) => {
    const plan = await planService.getPlanById(req.params.planId);
    if (!plan) {
        return res.status(httpStatus.NOT_FOUND).send({ message: 'Plan not found' });
    }

    const dbFeatures = typeof plan.features === 'string' ? JSON.parse(plan.features) : (plan.features || {});
    const hardDefaults = getPlanHardDefaults(plan.name);
    
    plan.features = {
        ...dbFeatures,
        ...hardDefaults
    };

    res.send(plan);
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
                analytics: 'locked',
                has_basic_features: true,
                has_custom_branding: false,
                has_top_position: false,
                has_one_on_one_support: true,
                has_customer_insight: true,
                has_slot_copy: false,
                has_patient_history: false,
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
                analytics: 'locked',
                has_basic_features: true,
                has_custom_branding: true,
                has_top_position: false,
                has_one_on_one_support: true,
                has_customer_insight: true,
                has_slot_copy: true,
                has_patient_history: false,
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
                analytics: 'basic',
                has_basic_features: true,
                has_custom_branding: true,
                has_top_position: false,
                has_one_on_one_support: true,
                has_customer_insight: true,
                has_slot_copy: true,
                has_patient_history: true,
                has_gallery_upload: true,
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
                has_slot_copy: true,
                has_patient_history: true,
                has_gallery_upload: true,
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

const syncUserPlans = catchAsync(async (req, res) => {
    const { pool } = require('../config/db');
    
    const plans = [
        {
            name: 'Free',
            price_monthly: 0,
            price_yearly: 0,
            commission_rate: 0,
            features: {
                max_active_appointments: 2,
                notifications: ['email'],
                priority: false,
                reschedule_limit: 0
            }
        },
        {
            name: 'Standard',
            price_monthly: 49,
            price_yearly: 490,
            commission_rate: 0,
            features: {
                max_active_appointments: 5,
                notifications: ['email', 'push'],
                priority: false,
                reschedule_limit: 1
            }
        },
        {
            name: 'Premium',
            price_monthly: 149,
            price_yearly: 1490,
            commission_rate: 0,
            features: {
                max_active_appointments: 999,
                notifications: ['email', 'push', 'sms'],
                priority: true,
                reschedule_limit: 999
            }
        }
    ];

    for (const p of plans) {
        // Use a combination of name and target_role for UPSERT logic if possible, 
        // but here we just check if it exists or update based on name if target_role matches.
        await pool.query(
            `INSERT INTO plans (name, price_monthly, price_yearly, commission_rate, features, target_role)
             VALUES ($1, $2, $3, $4, $5, 'user')
             ON CONFLICT (name) WHERE target_role = 'user' DO UPDATE SET 
                price_monthly = EXCLUDED.price_monthly,
                price_yearly = EXCLUDED.price_yearly,
                commission_rate = EXCLUDED.commission_rate,
                features = EXCLUDED.features`,
            [p.name, p.price_monthly, p.price_yearly, p.commission_rate, JSON.stringify(p.features)]
        );
    }

    res.send({ message: "User plans synced successfully! Free (0), Standard (49), Premium (149) are now active." });
});

module.exports = {
    createPlan,
    getPlans,
    getPlan,
    updatePlan,
    deletePlan,
    assignUserPlan,
    forceUpdateV3,
    syncUserPlans
};
