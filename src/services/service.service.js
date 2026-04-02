const { query, pool } = require('../config/db');
const httpStatus = require('../utils/httpStatus');
const ApiError = require('../utils/ApiError');

const createService = async (orgId, serviceBody) => {
    const {
        name,
        description,
        estimated_service_time,
        queue_scope
    } = serviceBody;

    const res = await query(
        `INSERT INTO services (
            org_id, name, description,
            queue_type, estimated_service_time, queue_scope, price
        )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
            orgId,
            name,
            description,
            'DYNAMIC',
            estimated_service_time || 30,
            queue_scope || 'CENTRAL',
            serviceBody.price || 0
        ]
    );
    return res.rows[0];
};

const getServices = async (orgId, publicOnly = false) => {
    // Admin also wants to "hide" deleted services by default as per user request
    const sql = 'SELECT * FROM services WHERE org_id = $1 AND is_active = TRUE ORDER BY created_at DESC';
    const res = await query(sql, [orgId]);
    return res.rows;
};

const getServiceById = async (orgId, serviceId) => {
    const res = await query('SELECT * FROM services WHERE id = $1 AND org_id = $2', [serviceId, orgId]);
    if (res.rows.length === 0) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Service not found');
    }
    return res.rows[0];
};

const updateService = async (orgId, serviceId, updateBody) => {
    const service = await getServiceById(orgId, serviceId);

    const allowed = [
        'name', 'description', 'is_active',
        'estimated_service_time', 'queue_scope', 'price'
    ];
    const keys = Object.keys(updateBody).filter(k => allowed.includes(k));
    const values = keys.map(k => updateBody[k]);

    if (keys.length === 0) return service;

    const setString = keys.map((key, index) => `${key} = $${index + 1}`).join(', ');

    const res = await query(
        `UPDATE services SET ${setString}, updated_at = NOW() WHERE id = $${keys.length + 1} AND org_id = $${keys.length + 2} RETURNING *`,
        [...values, serviceId, orgId]
    );

    return res.rows[0];
};

const deleteService = async (orgId, serviceId) => {
    await getServiceById(orgId, serviceId); // Validates existence and org ownership

    // Only block if there are ACTIVE (confirmed/pending) appointments
    const activeApptCheck = await query(
        `SELECT COUNT(*) FROM appointments 
         WHERE service_id = $1 AND status IN ('confirmed', 'pending', 'booked', 'serving')`, 
        [serviceId]
    );

    if (parseInt(activeApptCheck.rows[0].count) > 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, "You cannot delete a service that has active (confirmed/pending) appointments. Please complete/cancel them first.");
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Mark service as inactive (Soft Delete)
        await client.query('UPDATE services SET is_active = FALSE WHERE id = $1 AND org_id = $2', [serviceId, orgId]);

        // 2. Mark associated resource-service links as inactive/deleted if needed? 
        // Actually, just hiding the service is enough as the link becomes orphaned but harmless.
        // We also hide associated slots for resources that ONLY provide this service? 
        // No, cascade delete slots is for hard delete. For soft delete, we'll keep them but they won't be bookable anyway.
        
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

module.exports = {
    createService,
    getServices,
    getServiceById,
    updateService,
    deleteService
};
