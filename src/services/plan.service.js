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

const getPlans = async (role = null, includeInactive = false) => {
    let query = 'SELECT * FROM plans WHERE 1=1';
    const params = [];

    if (!includeInactive) {
        query += ' AND is_active = true';
    }

    if (role) {
        params.push(role);
        query += ` AND target_role = $${params.length}`;
    }

    // Exclude test plans (specifically the 10 Rs one)
    query += ' AND price_monthly != 10';

    query += ' ORDER BY target_role ASC, price_monthly ASC';
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

const assignPlanToUser = async (userId, planId, months = 1) => {
    // 1. Verify plan exists and is for users
    const plan = await getPlanById(planId);
    if (!plan || plan.target_role !== 'user') {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user plan');
    }

    // 2. Fetch current user state to check for stacking
    const currentRes = await pool.query('SELECT plan_id, subscription_expiry FROM users WHERE id = $1', [userId]);
    const current = currentRes.rows[0];

    const isPaid = parseFloat(plan.price_monthly) > 0;
    const isStacking = isPaid && current && current.plan_id === planId && current.subscription_expiry && new Date(current.subscription_expiry) > new Date();

    // 3. Calculate Expiry (Monthly: Dynamic, Free: 365 days)
    // If stacking, add interval to existing expiry. Otherwise, set from NOW().
    let expiryBase = 'NOW()';
    if (isStacking) {
        expiryBase = '$3'; // Will pass current.subscription_expiry
    }

    const interval = isPaid ? `INTERVAL '${parseInt(months)} months'` : "INTERVAL '365 days'";
    const expiryDate = `${expiryBase} + ${interval}`;

    // 4. Update user
    let updateQuery = `UPDATE users SET plan_id = $1, subscription_expiry = ${expiryDate}, updated_at = NOW()`;
    const updateParams = [planId, userId];
    if (isStacking) updateParams.push(current.subscription_expiry);

    if (isPaid) {
        updateQuery = `UPDATE users SET plan_id = $1, subscription_expiry = ${expiryDate}, last_paid_plan_id = $1, last_paid_plan_expiry = ${expiryDate}, updated_at = NOW()`;
    }

    const res = await pool.query(updateQuery + ' WHERE id = $2 RETURNING plan_id, subscription_expiry', updateParams);

    if (res.rows.length === 0) {
        throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }

    return res.rows[0];
};

const assignPlanToOrg = async (orgId, planId, months = 1) => {
    // 1. Verify plan exists and is for admins
    const plan = await getPlanById(planId);
    if (!plan || plan.target_role !== 'admin') {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid organization plan');
    }

    // 2. Fetch current org state to check for stacking
    const currentRes = await pool.query('SELECT plan_id, subscription_expiry FROM organizations WHERE id = $1', [orgId]);
    const current = currentRes.rows[0];

    const isPaid = parseFloat(plan.price_monthly) > 0;
    const isStacking = isPaid && current && current.plan_id === planId && current.subscription_expiry && new Date(current.subscription_expiry) > new Date();

    // 3. Calculate Expiry (Monthly: Dynamic, Free: 365 days)
    let expiryBase = 'NOW()';
    if (isStacking) {
        expiryBase = '$3'; // Will pass current.subscription_expiry
    }

    const interval = isPaid ? `INTERVAL '${parseInt(months)} months'` : "INTERVAL '365 days'";
    const expiryDate = `${expiryBase} + ${interval}`;

    // 4. Update organization
    let updateQuery = `UPDATE organizations SET plan_id = $1, subscription_expiry = ${expiryDate}, updated_at = NOW()`;
    const updateParams = [planId, orgId];
    if (isStacking) updateParams.push(current.subscription_expiry);

    if (isPaid) {
        updateQuery = `UPDATE organizations SET plan_id = $1, subscription_expiry = ${expiryDate}, last_paid_plan_id = $1, last_paid_plan_expiry = ${expiryDate}, updated_at = NOW()`;
    }

    const res = await pool.query(updateQuery + ' WHERE id = $2 RETURNING plan_id, subscription_expiry', updateParams);

    if (res.rows.length === 0) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found');
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
    assignPlanToUser,
    assignPlanToOrg
};
