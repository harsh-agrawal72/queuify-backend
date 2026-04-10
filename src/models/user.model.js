const { pool } = require('../config/db');

// --- Helpers ---
const DEFAULT_ADMIN_FEATURES = {
    max_resources: 1,
    max_admins: 1,
    analytics: 'locked',
    has_basic_features: true,
    has_custom_branding: false,
    has_gallery_upload: false,
    has_patient_history: false,
    has_top_position: false,
    has_one_on_one_support: false,
    has_customer_insight: false,
    has_premium_features: false
};

const DEFAULT_USER_FEATURES = {
    max_active_appointments: 2,
    notifications: ['email'],
    priority: false,
    reschedule_limit: 0
};

/**
 * Defensive Hydration: Returns hardcoded feature defaults based on Plan Name
 * This ensures features are unlocked even if DB JSON is outdated.
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

    // 3. Hierarchical Analytics Gating
    if (['free', 'starter'].includes(pName)) {
        features.analytics = 'basic';
    } else if (pName === 'professional') {
        features.analytics = 'standard';
        features.has_report_download = true;
    } else if (pName === 'enterprise') {
        features.analytics = 'premium';
        features.has_report_download = true;
        features.has_customer_insight = true;
        features.has_smart_insights = true;
        features.has_resource_ranking = true;
    }

    return features;
};

const formatUserWithPlan = (user) => {
    if (!user) return null;
    
    // Set default plan name if missing
    if (!user.plan_name) user.plan_name = 'Free';
    
    // Parse plan_features from DB if it exists
    let dbFeatures = {};
    try {
        if (user.plan_features) {
            dbFeatures = typeof user.plan_features === 'string' 
                ? JSON.parse(user.plan_features) 
                : user.plan_features;
        }
    } catch (e) {
        console.warn('[USER-MODEL] Failed to parse plan_features:', e.message);
    }

    // 1. Base Role Defaults
    const roleDefaults = (user.role === 'admin' || user.role === 'staff') 
        ? DEFAULT_ADMIN_FEATURES 
        : DEFAULT_USER_FEATURES;

    // 2. Hardcoded Plan Logic (Defensive Hydration) - Overrides DB for key features
    const planHardDefaults = getPlanHardDefaults(user.plan_name);

    // Order of Merge: 
    // Role Defaults -> DB Features -> Hardcoded Plan Defaults (to ensure they are unlocked)
    user.plan_features = { 
        ...roleDefaults, 
        ...(dbFeatures || {}),
        ...planHardDefaults 
    };

    return user;
};

/**
 * Create a new user
 */
const createUser = async (userBody) => {
    const { name, email, password, role, orgId, isPasswordSet, provider, google_id, phone, terms_accepted, plan_id } = userBody;
    const isPwdSet = isPasswordSet !== undefined ? isPasswordSet : true;

    // 1. Create the user with core columns that are GUARANTEED to exist
    const result = await pool.query(
        'INSERT INTO users (name, email, password_hash, role, org_id, is_password_set, activated_at, provider, google_id, phone) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
        [name, email, password, role, orgId || null, isPwdSet, isPwdSet ? new Date() : null, provider || 'local', google_id || null, phone || null]
    );
    let user = result.rows[0];

    // 2. Try to update plan_id (defensive: might not exist yet)
    if (plan_id) {
        try {
            const planResult = await pool.query(
                'UPDATE users SET plan_id = $1 WHERE id = $2 RETURNING *',
                [plan_id, user.id]
            );
            if (planResult.rows[0]) user = planResult.rows[0];
        } catch (e) {
            console.warn('[USER-MODEL] plan_id column not found in users table. Skipping plan assignment during registration.');
        }
    }

    // 3. Try to update terms_accepted (optional step, prevents crash if columns don't exist yet)
    if (terms_accepted) {
        try {
            const updateResult = await pool.query(
                'UPDATE users SET terms_accepted = $1, terms_accepted_at = NOW() WHERE id = $2 RETURNING *',
                [true, user.id]
            );
            if (updateResult.rows.length > 0) {
                user = updateResult.rows[0];
            }
        } catch (e) {
            console.warn('[USER-MODEL] Terms columns not found yet. Signup succeeded but terms not recorded.', e.message);
        }
    }

    return user;
};

/**
 * Update user by any identifiable field
 */
const updateUserByType = async (userId, updateBody) => {
    const fields = Object.keys(updateBody);
    if (fields.length === 0) return null;

    const setClause = fields.map((field, index) => `${field} = $${index + 1}`).join(', ');
    const values = Object.values(updateBody);
    values.push(userId);

    const result = await pool.query(
        `UPDATE users SET ${setClause}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
        values
    );
    return result.rows[0];
};

/**
 * Get user by email
 */
const getUserByEmail = async (email) => {
    // 1. Minimum Viable Query: Fetch core user data only
    const userRes = await pool.query(
        'SELECT * FROM users WHERE email = $1', 
        [email]
    );
    let user = userRes.rows[0];
    if (!user) return null;

    // 2. Safe Hydration: Fetch organization details if linked
    if (user.org_id) {
        try {
            const orgRes = await pool.query(
                'SELECT type as org_type, name as org_name, is_setup_completed as org_is_setup_completed, is_onboarded as org_is_onboarded, status as org_status, plan_id as org_plan_id, subscription_expiry FROM organizations WHERE id = $1',
                [user.org_id]
            );
            if (orgRes.rows[0]) {
                user = { ...user, ...orgRes.rows[0] };
            }
        } catch (e) {
            console.warn('[USER-MODEL] Failed to fetch safe org details:', e.message);
            // Fallback: fetch at least the name/status if the fancy columns are missing
            try {
                const fallbackOrg = await pool.query('SELECT name as org_name, status as org_status FROM organizations WHERE id = $1', [user.org_id]);
                if (fallbackOrg.rows[0]) user = { ...user, ...fallbackOrg.rows[0] };
            } catch (inner) { /* ignore */ }
        }
    }

    // 3. Safe Hydration: Fetch Plan details
    try {
        const planIdToFetch = (user.role === 'admin' || user.role === 'staff') ? (user.plan_id || user.org_plan_id) : user.plan_id; 
        if (planIdToFetch) {
            const planRes = await pool.query(
                'SELECT name as plan_name, features as plan_features FROM plans WHERE id = $1',
                [planIdToFetch]
            );
            if (planRes.rows[0]) {
                user = { ...user, ...planRes.rows[0] };
            }
        }
    } catch (e) {
        console.warn('[USER-MODEL] Failed to fetch safe plan details:', e.message);
    }

    // 4. Safe Hydration: Active Bookings count
    try {
        const countRes = await pool.query(
            'SELECT COUNT(*)::int as active_bookings_count FROM appointments WHERE user_id = $1 AND status IN (\'pending\', \'confirmed\', \'serving\')',
            [user.id]
        );
        user.active_bookings_count = countRes.rows[0]?.active_bookings_count || 0;
    } catch (e) {
        user.active_bookings_count = 0;
    }

    return formatUserWithPlan(user);
};

/**
 * Get user by ID
 */
const getUserById = async (id) => {
    // 1. Minimum Viable Query: Fetch core user data only
    const userRes = await pool.query(
        'SELECT * FROM users WHERE id = $1', 
        [id]
    );
    let user = userRes.rows[0];
    if (!user) return null;

    // 2. Safe Hydration: Fetch organization details if linked
    if (user.org_id) {
        try {
            const orgRes = await pool.query(
                'SELECT type as org_type, name as org_name, is_setup_completed as org_is_setup_completed, is_onboarded as org_is_onboarded, status as org_status, plan_id as org_plan_id, subscription_expiry, last_paid_plan_id, last_paid_plan_expiry FROM organizations WHERE id = $1',
                [user.org_id]
            );
            if (orgRes.rows[0]) {
                const org = orgRes.rows[0];
                
                // Defensive Hydration: If org has resources/services, it's basically set up.
                // This fix ensures invited admins skip onboarding for active organizations.
                if (!org.org_is_setup_completed) {
                    try {
                        const resourceCount = await pool.query('SELECT COUNT(*) FROM resources WHERE org_id = $1 AND is_active = TRUE', [user.org_id]);
                        if (parseInt(resourceCount.rows[0].count) > 0) {
                            org.org_is_setup_completed = true;
                            // Update DB for future optimization
                            pool.query('UPDATE organizations SET is_setup_completed = TRUE WHERE id = $1', [user.org_id]).catch(() => {});
                        }
                    } catch (e) { /* ignore */ }
                }

                user = { ...user, ...org };
            }
        } catch (e) {
            console.warn('[USER-MODEL] Failed to fetch safe org details:', e.message);
            try {
                const fallbackOrg = await pool.query('SELECT name as org_name, status as org_status FROM organizations WHERE id = $1', [user.org_id]);
                if (fallbackOrg.rows[0]) user = { ...user, ...fallbackOrg.rows[0] };
            } catch (inner) { /* ignore */ }
        }
    }

    // 3. Safe Hydration: Fetch Plan details
    try {
        const planIdToFetch = (user.role === 'admin' || user.role === 'staff') ? (user.plan_id || user.org_plan_id) : user.plan_id; 
        if (planIdToFetch) {
            const planRes = await pool.query(
                'SELECT name as plan_name, features as plan_features FROM plans WHERE id = $1',
                [planIdToFetch]
            );
            if (planRes.rows[0]) {
                user = { ...user, ...planRes.rows[0] };
            }
        }
    } catch (e) {
        console.warn('[USER-MODEL] Failed to fetch safe plan details:', e.message);
    }

     // 4. Safe Hydration: Active Bookings count
     try {
        const countRes = await pool.query(
            'SELECT COUNT(*)::int as active_bookings_count FROM appointments WHERE user_id = $1 AND status IN (\'pending\', \'confirmed\', \'serving\')',
            [user.id]
        );
        user.active_bookings_count = countRes.rows[0]?.active_bookings_count || 0;
    } catch (e) {
        user.active_bookings_count = 0;
    }

    return formatUserWithPlan(user);
};

/**
 * Check if email is taken
 */
const isEmailTaken = async (email) => {
    const user = await getUserByEmail(email);
    return !!user;
};

/**
 * Get total user count
 */
const getUserCount = async () => {
    const result = await pool.query('SELECT COUNT(*)::int AS count FROM users');
    return result.rows[0].count;
};

/**
 * Get organization by ID
 */
const getOrgById = async (orgId) => {
    const result = await pool.query('SELECT * FROM organizations WHERE id = $1', [orgId]);
    return result.rows[0];
};

/**
 * Update user password and status
 */
const updateUserPasswordAndStatus = async (userId, hashedPassword, isPasswordSet) => {

    const result = await pool.query(
        'UPDATE users SET password_hash = $1, is_password_set = $2, activated_at = COALESCE(activated_at, NOW()), updated_at = NOW() WHERE id = $3 RETURNING *',
        [hashedPassword, isPasswordSet, userId]
    );

    return result.rows[0];
};

/**
 * Update user last login time
 */
const updateUserLastLogin = async (userId) => {
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
};

/**
 * Update user status (soft delete, suspend, active)
 */
const updateUserStatus = async (userId, updateBody) => {
    const { is_active, is_suspended } = updateBody;
    const result = await pool.query(
        `UPDATE users 
         SET is_active = COALESCE($1, is_active), 
             is_suspended = COALESCE($2, is_suspended), 
             updated_at = NOW() 
         WHERE id = $3 
         RETURNING *`,
        [is_active, is_suspended, userId]
    );
    return result.rows[0];
};

module.exports = {
    createUser,
    getUserByEmail,
    getUserById,
    isEmailTaken,
    getUserCount,
    getOrgById,
    updateUserPasswordAndStatus,
    updateUserLastLogin,
    updateUserStatus,
    updateUserByType,
    getPlanHardDefaults,
    getAdminsByOrg: async (orgId) => {
        const result = await pool.query(
            'SELECT id, name, email FROM users WHERE org_id = $1 AND role = $2 AND is_suspended = FALSE',
            [orgId, 'admin']
        );
        return result.rows;
    }
};
