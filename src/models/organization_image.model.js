const { pool } = require('../config/db');

/**
 * Add an image to an organization
 */
const addImage = async (orgId, imageUrl, imageType, imageData = null, mimeType = null) => {
    const result = await pool.query(
        'INSERT INTO organization_images (org_id, image_url, image_type, image_data, mime_type) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [orgId, imageUrl, imageType, imageData, mimeType]
    );
    return result.rows[0];
};

/**
 * Get image by ID (including binary data)
 */
const getImageById = async (id) => {
    const result = await pool.query('SELECT * FROM organization_images WHERE id = $1', [id]);
    return result.rows[0];
};

/**
 * Get all images for an organization
 */
const getImagesByOrgId = async (orgId) => {
    const result = await pool.query('SELECT * FROM organization_images WHERE org_id = $1 ORDER BY created_at DESC', [orgId]);
    return result.rows;
};

/**
 * Delete an image
 */
const deleteImage = async (id, orgId) => {
    const result = await pool.query('DELETE FROM organization_images WHERE id = $1 AND org_id = $2 RETURNING *', [id, orgId]);
    return result.rows[0];
};

/**
 * Delete images of a specific type (e.g. replacing logo/cover)
 */
const deleteImagesByType = async (orgId, imageType) => {
    const result = await pool.query('DELETE FROM organization_images WHERE org_id = $1 AND image_type = $2 RETURNING *', [orgId, imageType]);
    return result.rows;
};

module.exports = {
    addImage,
    getImagesByOrgId,
    deleteImage,
    deleteImagesByType
};
