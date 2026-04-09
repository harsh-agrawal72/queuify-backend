const { pool } = require('../config/db');

const updatePlans = async () => {
    console.log('--- Updating Admin Membership Plans to V3 (Handwritten Data) ---');
    
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

        console.log('--- Phase 1: Syncing Plans ---');
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
            console.log(`Plan ${p.name} updated with V3 features.`);
        }

        console.log('✅ Admin plans updated successfully to V3!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error updating admin plans:', err.message);
        process.exit(1);
    }
};

updatePlans();
