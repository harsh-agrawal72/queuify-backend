const { pool } = require('../config/db');

/**
 * Create a new user
 */
const createUser = async (userBody) => {
    const { name, email, password, role, orgId, isPasswordSet, provider, google_id, phone, terms_accepted, plan_id } = userBody;
    const isPwdSet = isPasswordSet !== undefined ? isPasswordSet : true;

    // 1. Create the user with core columns
    const result = await pool.query(
        'INSERT INTO users (name, email, password_hash, role, org_id, is_password_set, activated_at, provider, google_id, phone, plan_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
        [name, email, password, role, orgId || null, isPwdSet, isPwdSet ? new Date() : null, provider || 'local', google_id || null, phone || null, plan_id || null]
    );
    const user = result.rows[0];

    // 2. Try to update terms_accepted (optional step, prevents crash if columns don't exist yet)
    if (terms_accepted) {
        try {
            const updateResult = await pool.query(
                'UPDATE users SET terms_accepted = $1, terms_accepted_at = NOW() WHERE id = $2 RETURNING *',
                [true, user.id]
            );
            if (updateResult.rows.length > 0) {
                return updateResult.rows[0];
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
    const result = await pool.query(
        `SELECT u.*, o.type as org_type, o.name as org_name, o.is_setup_completed as org_is_setup_completed,
                p.name as plan_name, p.features as plan_features,
                (SELECT COUNT(*)::int FROM appointments a WHERE a.user_id = u.id AND a.status IN ('pending', 'confirmed', 'serving')) as active_bookings_count
         FROM users u 
         LEFT JOIN organizations o ON u.org_id = o.id 
         LEFT JOIN plans p ON u.plan_id = p.id
         WHERE u.email = $1`,
        [email]
    );
    return result.rows[0];
};

/**
 * Get user by ID
 */
const getUserById = async (id) => {
    const result = await pool.query(
        `SELECT u.*, o.type as org_type, o.name as org_name, o.is_setup_completed as org_is_setup_completed,
                p.name as plan_name, p.features as plan_features,
                (SELECT COUNT(*)::int FROM appointments a WHERE a.user_id = u.id AND a.status IN ('pending', 'confirmed', 'serving')) as active_bookings_count
         FROM users u 
         LEFT JOIN organizations o ON u.org_id = o.id 
         LEFT JOIN plans p ON u.plan_id = p.id
         WHERE u.id = $1`,
        [id]
    );
    return result.rows[0];
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
    getAdminsByOrg: async (orgId) => {
        const result = await pool.query(
            'SELECT id, name, email FROM users WHERE org_id = $1 AND role = $2 AND is_suspended = FALSE',
            [orgId, 'admin']
        );
        return result.rows;
    }
};
