// backend/src/database/seed-admin-plans.js
const { pool } = require('../config/db');

const seedAdminPlans = async () => {
    console.log('Seeding Organization Membership Plans...');
    try {
        // 1. Starter Plan
        await pool.query(
            `INSERT INTO plans (name, price_monthly, price_yearly, commission_rate, features, target_role)
             SELECT 'Starter', 699, 6990, 5.00, 
        const plans = [
            {
                name: 'Free',
                price_monthly: 0,
                price_yearly: 0,
                commission_rate: 10.00,
                features: {
                    max_resources: 1,
                    max_admins: 1,
                    analytics: 'locked',
                    has_custom_branding: false,
                    has_top_position: false,
                    has_one_on_one_support: true,
                    has_customer_insight: true,
                    has_slot_copy: false,
                    has_premium_features: false
                }
            },
            {
                name: 'Starter',
                price_monthly: 699,
                price_yearly: 6999,
                commission_rate: 5.00,
                features: {
                    max_resources: 2,
                    max_admins: 1,
                    analytics: 'locked',
                    has_custom_branding: true,
                    has_top_position: false,
                    has_one_on_one_support: true,
                    has_customer_insight: true,
                    has_slot_copy: true,
                    has_premium_features: false
                }
            },
            {
                name: 'Professional',
                price_monthly: 999,
                price_yearly: 9999,
                commission_rate: 3.00,
                features: {
                    max_resources: 5,
                    max_admins: 2,
                    analytics: 'basic',
                    has_custom_branding: true,
                    has_top_position: false,
                    has_one_on_one_support: true,
                    has_customer_insight: true,
                    has_slot_copy: true,
                    has_patient_history: true,
                    has_premium_features: true
                }
            },
            {
                name: 'Enterprise',
                price_monthly: 1499,
                price_yearly: 14999,
                commission_rate: 1.50,
                features: {
                    max_resources: 20,
                    max_admins: 5,
                    analytics: 'advanced',
                    has_custom_branding: true,
                    has_top_position: true,
                    has_one_on_one_support: true,
                    has_customer_insight: true,
                    has_slot_copy: true,
                    has_patient_history: true,
                    has_premium_features: true
                }
            }
        ];

        for (const plan of plans) {
            await pool.query(
                `INSERT INTO plans (name, price_monthly, price_yearly, commission_rate, features, target_role)
                 SELECT $1, $2, $3, $4, $5, 'admin'
                 WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = $1 AND target_role = 'admin')`,
                [plan.name, plan.price_monthly, plan.price_yearly, plan.commission_rate, JSON.stringify(plan.features)]
            );
        }

        console.log('✅ Admin plans seeded successfully!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error seeding admin plans:', err.message);
        process.exit(1);
    }
};

seedAdminPlans();
