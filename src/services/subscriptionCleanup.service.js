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
        // 1. Get the 'Free' plan ID for users
        const freePlanRes = await pool.query(
            "SELECT id FROM plans WHERE name = 'Free' AND target_role = 'user' AND is_active = true LIMIT 1"
        );
        
        if (freePlanRes.rows.length === 0) {
            console.error('[SubscriptionCleanup] FAIL: Free user plan not found in database.');
            return;
        }
        
        const freePlanId = freePlanRes.rows[0].id;

        // 2. Perform the downgrade for all expired users
        // This query:
        // - Selects users on paid plans (expiry not null)
        // - Checks if current date > expiry
        // - Updates their plan to Free and clears expiry
        const result = await pool.query(
            `UPDATE users 
             SET plan_id = $1, 
                 subscription_expiry = NULL,
                 updated_at = NOW()
             WHERE plan_id != $1 
               AND subscription_expiry IS NOT NULL 
               AND subscription_expiry < NOW()
             RETURNING id, name`,
            [freePlanId]
        );

        if (result.rows.length > 0) {
            console.log(`[SubscriptionCleanup] Successfully downgraded ${result.rows.length} expired accounts:`);
            result.rows.forEach(user => console.log(` - ${user.name} (${user.id})`));
        } else {
            console.log('[SubscriptionCleanup] No expired accounts to downgrade.');
        }
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
