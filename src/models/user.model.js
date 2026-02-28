const pool = require('../config/db');

/**
 * Create a new user
 */
const createUser = async (userBody) => {
    const { name, email, password, role, orgId, isPasswordSet, provider, google_id } = userBody;
    const isPwdSet = isPasswordSet !== undefined ? isPasswordSet : true; // Default true for direct registration

    const result = await pool.query(
        'INSERT INTO users (name, email, password_hash, role, org_id, is_password_set, activated_at, provider, google_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, name, email, role, org_id, is_password_set, activated_at, created_at, provider, google_id, is_suspended',
        [name, email, password, role, orgId || null, isPwdSet, isPwdSet ? new Date() : null, provider || 'local', google_id || null]
    );
    return result.rows[0];
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
        `SELECT u.*, o.type as org_type, o.name as org_name 
         FROM users u 
         LEFT JOIN organizations o ON u.org_id = o.id 
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
        `SELECT u.*, o.type as org_type, o.name as org_name 
         FROM users u 
         LEFT JOIN organizations o ON u.org_id = o.id 
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
