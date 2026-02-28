const { query } = require('../config/db');
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
            queue_type, estimated_service_time, queue_scope
        )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
            orgId,
            name,
            description,
            'DYNAMIC',
            estimated_service_time || 30,
            queue_scope || 'CENTRAL'
        ]
    );
    return res.rows[0];
};

const getServices = async (orgId, publicOnly = false) => {
    let sql = 'SELECT * FROM services WHERE org_id = $1';
    if (publicOnly) sql += ' AND is_active = TRUE';
    sql += ' ORDER BY created_at DESC';
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
        'estimated_service_time', 'queue_scope'
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

    // Check if there are ANY appointments for this service
    const apptCheck = await query('SELECT COUNT(*) FROM appointments WHERE service_id = $1', [serviceId]);
    if (parseInt(apptCheck.rows[0].count) > 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, "you cant delete or modify the slot which have any appointment");
    }

    // Cascade delete slots associated with this service's resources
    await query(`
        DELETE FROM slots 
        WHERE resource_id IN (
            SELECT resource_id FROM resource_services WHERE service_id = $1
        )
    `, [serviceId]);

    await query('DELETE FROM services WHERE id = $1', [serviceId]);
};

module.exports = {
    createService,
    getServices,
    getServiceById,
    updateService,
    deleteService
};
