// backend/src/database/seed-admin-plans.js
const { pool } = require('../config/db');

const seedAdminPlans = async () => {
    console.log('Seeding Organization Membership Plans...');
    try {
        // 1. Starter Plan
        await pool.query(
            `INSERT INTO plans (name, price_monthly, price_yearly, commission_rate, features, target_role)
             SELECT 'Starter', 999, 9990, 5.00, 
                    '{"resources": 1, "staff": 2, "max_daily_bookings": 20, "analytics": "basic", "custom_branding": false}', 
                    'admin'
             WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = 'Starter' AND target_role = 'admin')`
        );

        // 2. Professional Plan
        await pool.query(
            `INSERT INTO plans (name, price_monthly, price_yearly, commission_rate, features, target_role)
             SELECT 'Professional', 2499, 24990, 3.00, 
                    '{"resources": 5, "staff": 10, "max_daily_bookings": 100, "analytics": "advanced", "custom_branding": true, "broadcast": true}', 
                    'admin'
             WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = 'Professional' AND target_role = 'admin')`
        );

        // 3. Enterprise Plan
        await pool.query(
            `INSERT INTO plans (name, price_monthly, price_yearly, commission_rate, features, target_role)
             SELECT 'Enterprise', 4999, 49990, 1.50, 
                    '{"resources": 999, "staff": 999, "max_daily_bookings": 999, "analytics": "enterprise", "custom_branding": true, "broadcast": true, "multi_branch": true}', 
                    'admin'
             WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = 'Enterprise' AND target_role = 'admin')`
        );

        console.log('✅ Admin plans seeded successfully!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error seeding admin plans:', err.message);
        process.exit(1);
    }
};

seedAdminPlans();
