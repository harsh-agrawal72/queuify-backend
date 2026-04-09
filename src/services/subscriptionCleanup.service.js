// backend/src/services/subscriptionCleanup.service.js
const { pool } = require('../config/db');

/**
 * Hourly cleanup task:
 * 1. Find users with expired paid subscriptions.
 * 2. Downgrade them to the 'Free' tier.
 */
const runSubscriptionCleanup = async () => {
    console.log('[SubscriptionCleanup] Checking for expired memberships...');
    try {
        // 1. Handle Users Downgrade
        const freeUserPlanRes = await pool.query(
            "SELECT id FROM plans WHERE name = 'Free' AND target_role = 'user' AND is_active = true LIMIT 1"
        );
        
        if (freeUserPlanRes.rows.length > 0) {
            const freeUserPlanId = freeUserPlanRes.rows[0].id;
            const userResult = await pool.query(
                `UPDATE users 
                 SET plan_id = $1, 
                     subscription_expiry = NULL,
                     updated_at = NOW()
                 WHERE plan_id != $1 
                   AND subscription_expiry IS NOT NULL 
                   AND subscription_expiry < NOW()
                 RETURNING id, name`,
                [freeUserPlanId]
            );
            if (userResult.rows.length > 0) {
                console.log(`[SubscriptionCleanup] Successfully downgraded ${userResult.rows.length} expired users.`);
            }
        }

        // 2. Handle Organizations Downgrade
        const freeOrgPlanRes = await pool.query(
            "SELECT id FROM plans WHERE name = 'Free' AND target_role = 'admin' AND is_active = true LIMIT 1"
        );
        
        if (freeOrgPlanRes.rows.length > 0) {
            const freeOrgPlanId = freeOrgPlanRes.rows[0].id;
            const orgResult = await pool.query(
                `UPDATE organizations 
                 SET plan_id = $1, 
                     subscription_expiry = NULL,
                     updated_at = NOW()
                 WHERE plan_id != $1 
                   AND subscription_expiry IS NOT NULL 
                   AND subscription_expiry < NOW()
                 RETURNING id, name`,
                [freeOrgPlanId]
            );
            if (orgResult.rows.length > 0) {
                console.log(`[SubscriptionCleanup] Successfully downgraded ${orgResult.rows.length} expired organizations.`);
                orgResult.rows.forEach(org => console.log(` - Org: ${org.name} (${org.id})`));
            }
        }

        console.log('[SubscriptionCleanup] Cleanup cycle completed.');
    } catch (err) {
        console.error('[SubscriptionCleanup] ERROR during execution:', err.message);
    }
};

/**
 * Initialize the recurring job
 */
const initSubscriptionCleanup = () => {
    // Run once at startup
    runSubscriptionCleanup();

    // Then run every 1 hour (3600000ms)
    // For testing/demo purposes, we could run it more frequently.
    const interval = 60 * 60 * 1000; 
    setInterval(runSubscriptionCleanup, interval);
    console.log('[SubscriptionCleanup] Service initialized (Running every 1 hour)');
};

module.exports = {
    initSubscriptionCleanup,
    runSubscriptionCleanup
};
