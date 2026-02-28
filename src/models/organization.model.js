const { pool } = require('../config/db');

/**
 * Create a new organization
 */
const createOrganization = async (orgBody) => {
    const { name, slug, contactEmail, orgCode, type = 'Clinic', status = 'active' } = orgBody;
    const result = await pool.query(
        'INSERT INTO organizations (name, slug, contact_email, org_code, status, phone, address, plan, type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
        [name, slug, contactEmail, orgCode, status, orgBody.phone || null, orgBody.address || null, orgBody.plan || 'basic', type]
    );
    return result.rows[0];
};

/**
 * Get organization by slug
 */
const getOrganizationBySlug = async (slug) => {
    const result = await pool.query('SELECT * FROM organizations WHERE slug = $1', [slug]);
    return result.rows[0];
};

/**
 * Get organization by ID
 */
const getOrganizationById = async (id) => {
    const result = await pool.query('SELECT * FROM organizations WHERE id = $1', [id]);
    return result.rows[0];
};

/**
 * Query organizations with optional search
 * @param {Object} filter - { search: string }
 */
const queryOrganizations = async (filter = {}) => {
    let query = `
        SELECT o.*, 
               COALESCE(AVG(r.rating), 0) as avg_rating, 
               COUNT(r.id) as total_reviews
        FROM organizations o
        LEFT JOIN reviews r ON o.id = r.org_id
        WHERE 1=1
    `;
    const params = [];

    if (filter.status) {
        params.push(filter.status);
        query += ` AND o.status = $${params.length}`;
    }

    if (filter.type) {
        params.push(filter.type);
        query += ` AND o.type = $${params.length}`;
    }

    if (filter.search) {
        params.push(`%${filter.search}%`);
        query += ` AND (o.name ILIKE $${params.length} OR o.org_code ILIKE $${params.length})`;
    }

    query += ' GROUP BY o.id ORDER BY o.created_at DESC';
    const result = await pool.query(query, params);
    return result.rows;
};

/**
 * Update organization status
 */
const updateOrganizationStatus = async (id, status) => {
    const result = await pool.query(
        'UPDATE organizations SET status = $1 WHERE id = $2 RETURNING *',
        [status, id]
    );
    return result.rows[0];
}

/**
 * Get organization by email
 */
const getOrganizationByEmail = async (email) => {
    const result = await pool.query('SELECT * FROM organizations WHERE contact_email = $1', [email]);
    return result.rows[0];
};

/**
 * Get organization by phone
 */
const getOrganizationByPhone = async (phone) => {
    const result = await pool.query('SELECT * FROM organizations WHERE phone = $1', [phone]);
    return result.rows[0];
};

module.exports = {
    createOrganization,
    getOrganizationBySlug,
    getOrganizationById,
    queryOrganizations,
    updateOrganizationStatus,
    getOrganizationByEmail,
    getOrganizationByPhone
};
