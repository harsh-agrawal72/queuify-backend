const { pool } = require('../config/db');

/**
 * Migration: Backfill last_paid_plan columns for existing active users/orgs.
 * This ensures that if a user upgraded before the restoration feature was added,
 * they can still "restoration" their plan if they downgrade to free.
 */
const backfill = async () => {
    try {
        console.log('--- Starting Subscription Restoration Backfill ---');

        // 1. Backfill Organizations
        // We look for orgs on a paid plan (price > 0) whose last_paid_plan_id is NULL
        const orgResult = await pool.query(`
            UPDATE organizations o
            SET 
                last_paid_plan_id = o.plan_id,
                last_paid_plan_expiry = o.subscription_expiry,
                updated_at = NOW()
            FROM plans p
            WHERE o.plan_id = p.id
            AND p.price_monthly > 0
            AND o.last_paid_plan_id IS NULL
            RETURNING o.id, o.name;
        `);
        console.log(`[OK] Backfilled ${orgResult.rowCount} Organizations`);
        orgResult.rows.forEach(row => console.log(`   - Org: ${row.name} (${row.id})`));

        // 2. Backfill Users (for individual premium plans if any)
        const userResult = await pool.query(`
            UPDATE users u
            SET 
                last_paid_plan_id = u.plan_id,
                last_paid_plan_expiry = u.subscription_expiry,
                updated_at = NOW()
            FROM plans p
            WHERE u.plan_id = p.id
            AND p.price_monthly > 0
            AND u.last_paid_plan_id IS NULL
            RETURNING u.id, u.name;
        `);
        console.log(`[OK] Backfilled ${userResult.rowCount} Users`);
        userResult.rows.forEach(row => console.log(`   - User: ${row.name} (${row.id})`));

        console.log('--- Backfill Completed Successfully ---');
        process.exit(0);
    } catch (err) {
        console.error('--- Backfill Failed ---');
        console.error(err.message);
        process.exit(1);
    }
};

backfill();
