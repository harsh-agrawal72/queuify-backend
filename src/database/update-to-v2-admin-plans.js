// backend/src/database/update-to-v2-admin-plans.js
const { pool } = require('../config/db');

const updatePlans = async () => {
    console.log('--- Updating Admin Membership Plans to V2 ---');
    
    // Phase 0: Schema Updates
    try {
        console.log('--- Phase 0: Updating Schema ---');
        await pool.query('ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_expiry TIMESTAMP;');
        console.log('Added subscription_expiry column to organizations.');
    } catch (err) {
        console.warn('Notice: subscription_expiry column update:', err.message);
    }

    // Phase 1: Plans Update
    try {
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
                commission_rate: 5.0,
                features: {
                    max_resources: 2,
                    max_admins: 1,
                    analytics: 'locked',
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
                commission_rate: 3.0,
                features: {
                    max_resources: 5,
                    max_admins: 2,
                    analytics: 'basic',
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
                commission_rate: 1.5,
                features: {
                    max_resources: 20,
                    max_admins: 5,
                    analytics: 'advanced',
                    has_custom_branding: true,
                    has_top_position: true,
                    has_one_on_one_support: true,
                    has_customer_insight: true,
                    has_premium_features: true
                }
            }
        ];

        console.log('--- Phase 1: Creating/Updating Plans ---');
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
            console.log(`Plan ${p.name} updated.`);
        }

        console.log('\n--- Phase 2: Updating Organizations to Default Free Plan ---');
        const freePlanRes = await pool.query("SELECT id FROM plans WHERE name = 'Free' AND target_role = 'admin' LIMIT 1");
        if (freePlanRes.rows.length === 0) throw new Error("Free plan not found after insertion!");
        
        const freePlanId = freePlanRes.rows[0].id;

        const updateOrgs = await pool.query(
            "UPDATE organizations SET plan_id = $1, subscription_expiry = NULL WHERE plan_id IS NULL OR plan = 'basic'",
            [freePlanId]
        );
        console.log(`Updated ${updateOrgs.rowCount} organizations to the Free plan.`);

        console.log('✅ Admin plans updated successfully!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error updating admin plans:', err.message);
        process.exit(1);
    }
};

updatePlans();
