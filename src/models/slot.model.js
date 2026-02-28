const { pool } = require('../config/db');

/**
 * Create a slot
 */
const createSlot = async (slotBody) => {
    const { orgId, startTime, endTime, maxCapacity, resourceId } = slotBody;
    const result = await pool.query(
        `INSERT INTO slots (org_id, start_time, end_time, max_capacity, resource_id) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING *`,
        [orgId, startTime, endTime, maxCapacity, resourceId]
    );
    return result.rows[0];
};

/**
 * Check for overlapping slots on the same resource
 */
const hasOverlap = async (orgId, startTime, endTime, resourceId) => {
    const result = await pool.query(
        'SELECT id FROM slots WHERE org_id = $1 AND resource_id = $4 AND start_time < $3 AND end_time > $2',
        [orgId, startTime, endTime, resourceId]
    );
    return result.rows.length > 0;
};

/**
 * Get resource by ID (for validation)
 */
const getResourceById = async (resourceId) => {
    const result = await pool.query('SELECT * FROM resources WHERE id = $1', [resourceId]);
    return result.rows[0];
};

/**
 * Get slots with joined service and resource names
 */
const getSlotsWithDetails = async (filters) => {
    let query = `
        SELECT s.*, 
               r.name as resource_name, r.type as resource_type,
               r.concurrent_capacity as resource_capacity,
               COALESCE(array_agg(rs.service_id) FILTER (WHERE rs.service_id IS NOT NULL), '{}') as service_ids,
               COALESCE(array_agg(svc.name) FILTER (WHERE svc.name IS NOT NULL), '{}') as service_names
        FROM slots s
        LEFT JOIN resources r ON s.resource_id = r.id
        LEFT JOIN resource_services rs ON r.id = rs.resource_id
        LEFT JOIN services svc ON rs.service_id = svc.id
        WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (filters.orgId) {
        query += ` AND s.org_id = $${idx++}`;
        params.push(filters.orgId);
    }
    if (filters.resourceId) {
        query += ` AND s.resource_id = $${idx++}`;
        params.push(filters.resourceId);
    }
    if (filters.serviceId) {
        query += ` AND EXISTS (SELECT 1 FROM resource_services rs WHERE rs.resource_id = s.resource_id AND rs.service_id = $${idx++})`;
        params.push(filters.serviceId);
    }
    if (filters.date) {
        query += ` AND DATE(s.start_time) = $${idx++}`;
        params.push(filters.date);
    }
    // SaaS-Safe Soft Delete Check
    query += ` AND 1=1`;

    if (filters.isActive) {
        query += ` AND s.is_active = TRUE`;
    }

    query += ' GROUP BY s.id, r.id ORDER BY s.start_time ASC';

    const result = await pool.query(query, params);
    return result.rows;
};

/**
 * Get available slots for user booking (future, not full)
 */
const getAvailableSlots = async (orgId, filters = {}) => {
    let query = 'SELECT * FROM slots WHERE org_id = $1 AND booked_count < max_capacity AND start_time > NOW() AND is_active = TRUE AND status = \'active\'';
    const params = [orgId];
    let idx = 2;

    if (filters.serviceId) {
        query += ` AND EXISTS (SELECT 1 FROM resource_services rs WHERE rs.resource_id = slots.resource_id AND rs.service_id = $${idx++})`;
        params.push(filters.serviceId);
    }
    if (filters.resourceId) {
        query += ` AND resource_id = $${idx++}`;
        params.push(filters.resourceId);
    }

    query += ' ORDER BY start_time ASC';

    const result = await pool.query(query, params);
    return result.rows;
};

const getSlotsByOrgId = async (orgId) => {
    const result = await pool.query(
        'SELECT * FROM slots WHERE org_id = $1 AND is_active = TRUE ORDER BY start_time ASC',
        [orgId]
    );
    return result.rows;
};

const getSlotsByResourceId = async (resourceId) => {
    const result = await pool.query(
        'SELECT * FROM slots WHERE resource_id = $1 AND is_active = TRUE ORDER BY start_time ASC',
        [resourceId]
    );
    return result.rows;
};

const getSlotById = async (id) => {
    const result = await pool.query('SELECT * FROM slots WHERE id = $1', [id]);
    return result.rows[0];
};

const deleteSlot = async (id) => {
    const result = await pool.query('DELETE FROM slots WHERE id = $1 RETURNING *', [id]);
    return result.rows[0];
};

module.exports = {
    createSlot,
    hasOverlap,
    getResourceById,
    getSlotsWithDetails,
    getAvailableSlots,
    getSlotsByOrgId,
    getSlotsByResourceId,
    getSlotById,
    deleteSlot
};
