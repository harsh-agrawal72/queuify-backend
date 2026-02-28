const { pool } = require('../config/db');

/**
 * Get organization profile by org_id
 */
const getProfileByOrgId = async (orgId) => {
    const result = await pool.query('SELECT * FROM organization_profiles WHERE org_id = $1', [orgId]);
    return result.rows[0];
};

/**
 * Upsert organization profile
 */
const upsertProfile = async (orgId, profileData) => {
    const protectedFields = ['id', 'org_id', 'created_at', 'updated_at', 'verified', 'images', 'trustScore', 'isVerified'];
    const keys = Object.keys(profileData).filter(key => !protectedFields.includes(key));

    if (keys.length === 0) {
        // If no fields to update, just ensure it exists or return current
        const existing = await getProfileByOrgId(orgId);
        if (existing) return existing;
        const result = await pool.query('INSERT INTO organization_profiles (org_id) VALUES ($1) ON CONFLICT (org_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP RETURNING *', [orgId]);
        return result.rows[0];
    }

    const setValues = keys.map((key, index) => `${key} = $${index + 2}`);

    const query = `
        INSERT INTO organization_profiles (org_id, ${keys.join(', ')})
        VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
        ON CONFLICT (org_id) DO UPDATE SET 
            ${setValues.join(', ')},
            updated_at = CURRENT_TIMESTAMP
        RETURNING *
    `;

    const values = [orgId, ...keys.map(k => {
        const val = profileData[k];
        // Convert empty strings to null for numeric fields or general safety
        if (val === '' && (k === 'established_year' || k === 'total_staff')) {
            return null;
        }
        return val;
    })];
    const result = await pool.query(query, values);
    return result.rows[0];
};

module.exports = {
    getProfileByOrgId,
    upsertProfile,
};
