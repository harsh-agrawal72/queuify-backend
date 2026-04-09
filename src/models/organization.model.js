const { pool } = require('../config/db');

/**
 * Create a new organization
 */
const createOrganization = async (orgBody) => {
    const { name, slug, contactEmail, orgCode, type = 'Clinic', status = 'active', plan_id = null } = orgBody;
    const result = await pool.query(
        'INSERT INTO organizations (name, slug, contact_email, org_code, status, phone, address, plan, type, plan_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
        [name, slug, contactEmail, orgCode, status, orgBody.phone || null, orgBody.address || null, orgBody.plan || 'Free', type, plan_id]
    );
    return result.rows[0];
};

/**
 * Get organization by slug
 */
const getOrganizationBySlug = async (slug) => {
    const result = await pool.query(`
        SELECT o.*, p.name as plan_name, p.features as plan_features 
        FROM organizations o
        LEFT JOIN plans p ON o.plan_id = p.id
        WHERE o.slug ILIKE $1`, [slug]);
    return result.rows[0];
};

/**
 * Get organization by ID
 */
const getOrganizationById = async (id) => {
    const result = await pool.query(`
        SELECT o.*, p.name as plan_name, p.features as plan_features 
        FROM organizations o
        LEFT JOIN plans p ON o.plan_id = p.id
        WHERE o.id = $1`, [id]);
    return result.rows[0];
};

/**
 * Query organizations with optional search
 * @param {Object} filter - { search: string }
 */
const queryOrganizations = async (filter = {}) => {
    let selectFields = `
        o.*, 
        p.description, p.verified as is_verified, p.address as profile_address, 
        p.images as profile_images, 
        logo.image_url as logo_url, 
        logo.id as logo_image_id,
        COALESCE(AVG(r.rating), 0) as avg_rating, 
        COUNT(r.id) as total_reviews,
        CASE WHEN fav.user_id IS NOT NULL THEN TRUE ELSE FALSE END as is_favorite
    `;
    let fromClause = `
        FROM organizations o
        LEFT JOIN organization_profiles p ON o.id = p.org_id
        LEFT JOIN reviews r ON o.id = r.org_id
        LEFT JOIN (
            SELECT org_id, image_url, id 
            FROM organization_images 
            WHERE image_type = 'logo'
        ) logo ON o.id = logo.org_id
        LEFT JOIN user_favorites fav ON o.id = fav.org_id AND fav.user_id = $1
    `;
    let whereClause = ` WHERE 1=1 `;
    const params = [filter.userId || null]; // Current user ID always at $1

    if (filter.status) {
        params.push(filter.status);
        whereClause += ` AND o.status = $${params.length}`;
    }

    if (filter.type) {
        params.push(filter.type);
        whereClause += ` AND o.type = $${params.length}`;
    }

    if (filter.onlyFavorites) {
        whereClause += ` AND fav.user_id IS NOT NULL `;
    }

    if (filter.search) {
        params.push(`%${filter.search}%`);
        const searchIdx = params.length;
        whereClause += ` AND (
            o.name ILIKE $${searchIdx} 
            OR o.org_code ILIKE $${searchIdx}
            OR o.type ILIKE $${searchIdx}
            OR o.address ILIKE $${searchIdx}
            OR p.description ILIKE $${searchIdx}
            OR p.keywords ILIKE $${searchIdx}
            OR p.city ILIKE $${searchIdx}
            OR EXISTS (
                SELECT 1 FROM services s 
                WHERE s.org_id = o.id AND s.name ILIKE $${searchIdx}
            )
            OR EXISTS (
                SELECT 1 FROM resources res 
                WHERE res.org_id = o.id AND res.name ILIKE $${searchIdx}
            )
        )`;
    }

    let orderBy = 'has_top_priority DESC, o.created_at DESC';
    if (filter.userCity || filter.userPincode || filter.userState) {
        const cityParam = filter.userCity || '';
        const stateParam = filter.userState || '';
        const pincodeParam = filter.userPincode || '';
        
        params.push(pincodeParam, cityParam, stateParam);
        const pIdx = params.length - 2;
        const cIdx = params.length - 1;
        const sIdx = params.length;

        selectFields += `
            , (
                CASE WHEN p.pincode = $${pIdx} THEN 10 ELSE 0 END +
                CASE WHEN p.city ILIKE $${cIdx} THEN 5 ELSE 0 END +
                CASE WHEN p.state ILIKE $${sIdx} THEN 2 ELSE 0 END
            ) as proximity_score
        `;
        orderBy = `has_top_priority DESC, proximity_score DESC, o.created_at DESC`;
    }

    const query = `
        SELECT ${selectFields}, 
               COALESCE((plans.features->>'has_top_position')::boolean, false) as has_top_priority
        FROM organizations o
        LEFT JOIN plans ON o.plan_id = plans.id
        LEFT JOIN organization_profiles p ON o.id = p.org_id
        LEFT JOIN reviews r ON o.id = r.org_id
        LEFT JOIN (
            SELECT org_id, image_url, id 
            FROM organization_images 
            WHERE image_type = 'logo'
        ) logo ON o.id = logo.org_id
        LEFT JOIN user_favorites fav ON o.id = fav.org_id AND fav.user_id = $1
        ${whereClause}
        GROUP BY 
            o.id, p.id, p.description, p.verified, p.address, p.images, p.city, p.state, p.pincode,
            logo.image_url, logo.id, fav.user_id, plans.features
        ORDER BY ${orderBy}
    `;
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
    const result = await pool.query(`
        SELECT o.*, p.name as plan_name, p.features as plan_features 
        FROM organizations o
        LEFT JOIN plans p ON o.plan_id = p.id
        WHERE o.contact_email = $1`, [email]);
    return result.rows[0];
};

/**
 * Update organization setup status
 */
const updateSetupStatus = async (id, status) => {
    const result = await pool.query(
        'UPDATE organizations SET is_setup_completed = $1 WHERE id = $2 RETURNING *',
        [status, id]
    );
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
    getOrganizationByPhone,
    updateSetupStatus
};
