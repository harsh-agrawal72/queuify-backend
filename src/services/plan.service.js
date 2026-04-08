const { pool } = require('../config/db');
const httpStatus = require('../utils/httpStatus');
const ApiError = require('../utils/ApiError');

const createPlan = async (planBody) => {
    const { name, price_monthly, price_yearly, commission_rate, features, target_role } = planBody;

    const res = await pool.query(
        `INSERT INTO plans (name, price_monthly, price_yearly, commission_rate, features, target_role)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [name, price_monthly, price_yearly, commission_rate, features, target_role || 'admin']
    );
    return res.rows[0];
};

const getPlans = async (role = null) => {
    let query = 'SELECT * FROM plans WHERE is_active = true';
    const params = [];

    if (role) {
        query += ' AND target_role = $1';
        params.push(role);
    }

    query += ' ORDER BY price_monthly ASC';
    const res = await pool.query(query, params);
    return res.rows;
};

const getPlanById = async (id) => {
    const res = await pool.query('SELECT * FROM plans WHERE id = $1', [id]);
    return res.rows[0];
};

const getPlanByName = async (name, role = 'user') => {
    const res = await pool.query('SELECT * FROM plans WHERE name = $1 AND target_role = $2', [name, role]);
    return res.rows[0];
};

const updatePlan = async (id, updateBody) => {
    const { name, price_monthly, price_yearly, commission_rate, features, is_active, target_role } = updateBody;

    const res = await pool.query(
        `UPDATE plans 
         SET name = COALESCE($1, name),
             price_monthly = COALESCE($2, price_monthly),
             price_yearly = COALESCE($3, price_yearly),
             commission_rate = COALESCE($4, commission_rate),
             features = COALESCE($5, features),
             is_active = COALESCE($6, is_active),
             target_role = COALESCE($7, target_role),
             updated_at = NOW()
         WHERE id = $8
         RETURNING *`,
        [name, price_monthly, price_yearly, commission_rate, features, is_active, target_role, id]
    );

    if (res.rows.length === 0) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Plan not found');
    }
    return res.rows[0];
};

const assignPlanToUser = async (userId, planId) => {
    // 1. Verify plan exists and is for users
    const plan = await getPlanById(planId);
    if (!plan || plan.target_role !== 'user') {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user plan');
    }

    // 2. Update user
    const res = await pool.query(
        "UPDATE users SET plan_id = $1, updated_at = NOW() WHERE id = $2 RETURNING plan_id",
        [planId, userId]
    );

    if (res.rows.length === 0) {
        throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }

    return res.rows[0];
};

const deletePlan = async (id) => {
    // Soft delete or hard delete? Plans linked to orgs should probably be soft deleted or restricted.
    // Let's check constraints. If orgs use it, hard delete will fail (FK). 
    // We'll try hard delete, if it fails, user must reassign orgs first.
    try {
        await pool.query('DELETE FROM plans WHERE id = $1', [id]);
    } catch (err) {
        if (err.code === '23503') { // ForeignKeyViolation
            throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot delete plan assigned to organizations. Archive it instead.');
        }
        throw err;
    }
};

module.exports = {
    createPlan,
    getPlans,
    getPlanById,
    getPlanByName,
    updatePlan,
    deletePlan,
    assignPlanToUser
};
