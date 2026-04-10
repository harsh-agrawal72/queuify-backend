const { pool } = require('../config/db');

async function fixSubscriptionExpiry() {
    console.log('--- Starting Subscription Expiry Fix ---');
    try {
        // 1. Fix Organizations
        console.log('Updating organization expiry dates...');
        const orgResult = await pool.query(`
            UPDATE organizations o
            SET subscription_expiry = CASE 
                WHEN p.price_monthly > 0 THEN NOW() + INTERVAL '30 days'
                ELSE NOW() + INTERVAL '365 days'
            END
            FROM plans p
            WHERE o.plan_id = p.id 
            AND o.subscription_expiry IS NULL
            RETURNING o.id, o.name, o.subscription_expiry;
        `);
        console.log(`Updated ${orgResult.rowCount} organizations.`);
        orgResult.rows.forEach(row => {
            console.log(` - ${row.name}: New Expiry -> ${row.subscription_expiry}`);
        });

        // 2. Fix Users (Consumer Plans)
        console.log('\nUpdating user expiry dates...');
        const userResult = await pool.query(`
            UPDATE users u
            SET subscription_expiry = CASE 
                WHEN p.price_monthly > 0 THEN NOW() + INTERVAL '30 days'
                ELSE NOW() + INTERVAL '365 days'
            END
            FROM plans p
            WHERE u.plan_id = p.id 
            AND u.subscription_expiry IS NULL
            RETURNING u.id, u.name, u.subscription_expiry;
        `);
        console.log(`Updated ${userResult.rowCount} users.`);
        userResult.rows.forEach(row => {
            console.log(` - ${row.name}: New Expiry -> ${row.subscription_expiry}`);
        });

        // 3. Fallback for orgs with NO plan_id but are active (should be rare)
        console.log('\nSetting fallback for orgs without plan_id (Free default)...');
        const fallbackRes = await pool.query(`
            UPDATE organizations 
            SET subscription_expiry = NOW() + INTERVAL '365 days'
            WHERE subscription_expiry IS NULL
            RETURNING id, name;
        `);
        console.log(`Updated ${fallbackRes.rowCount} fallback organizations.`);

        console.log('\n--- Script Completed Successfully ---');
    } catch (err) {
        console.error('Error during script execution:', err);
    } finally {
        process.exit();
    }
}

fixSubscriptionExpiry();
