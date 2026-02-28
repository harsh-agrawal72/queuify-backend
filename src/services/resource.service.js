const { query, pool } = require('../config/db');
const httpStatus = require('../utils/httpStatus');
const ApiError = require('../utils/ApiError');

const createResource = async (orgId, resourceBody) => {
    const { name, type, description, concurrent_capacity, serviceIds } = resourceBody;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const res = await client.query(
            `INSERT INTO resources (org_id, name, type, description, concurrent_capacity)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [orgId, name, type || 'staff', description, concurrent_capacity || 1]
        );
        const resource = res.rows[0];

        let allServiceIds = serviceIds || [];
        if (resourceBody.serviceId && !allServiceIds.includes(resourceBody.serviceId)) {
            allServiceIds.push(resourceBody.serviceId);
        }

        if (allServiceIds.length > 0) {
            for (const serviceId of allServiceIds) {
                await client.query(
                    'INSERT INTO resource_services (resource_id, service_id) VALUES ($1, $2)',
                    [resource.id, serviceId]
                );
            }
        }

        await client.query('COMMIT');
        return resource;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

const getResourcesByServiceId = async (serviceId, publicOnly = false) => {
    let sql = `
        SELECT r.* 
        FROM resources r
        JOIN resource_services rs ON r.id = rs.resource_id
        WHERE rs.service_id = $1
    `;
    if (publicOnly) sql += ' AND r.is_active = TRUE';
    sql += ' ORDER BY r.created_at DESC';
    const res = await query(sql, [serviceId]);
    return res.rows;
};

const getResources = async (orgId, publicOnly = false) => {
    let sql = `
        SELECT r.*, 
               COALESCE(array_agg(rs.service_id) FILTER (WHERE rs.service_id IS NOT NULL), '{}') as service_ids
        FROM resources r
        LEFT JOIN resource_services rs ON r.id = rs.resource_id
        WHERE r.org_id = $1
    `;
    if (publicOnly) sql += ' AND r.is_active = TRUE';
    sql += ' GROUP BY r.id ORDER BY r.created_at DESC';
    const res = await query(sql, [orgId]);
    return res.rows;
};

const getResourceById = async (orgId, resourceId) => {
    const res = await query(`
        SELECT r.*, 
               COALESCE(array_agg(rs.service_id) FILTER (WHERE rs.service_id IS NOT NULL), '{}') as service_ids
        FROM resources r
        LEFT JOIN resource_services rs ON r.id = rs.resource_id
        WHERE r.id = $1 AND r.org_id = $2
        GROUP BY r.id
    `, [resourceId, orgId]);

    if (res.rows.length === 0) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Resource not found');
    }
    return res.rows[0];
};

const updateResource = async (orgId, resourceId, updateBody) => {
    const { serviceIds, ...otherUpdates } = updateBody;
    const resource = await getResourceById(orgId, resourceId);

    const allowed = ['name', 'type', 'description', 'concurrent_capacity', 'is_active'];
    const keys = Object.keys(otherUpdates).filter(k => allowed.includes(k));
    const values = keys.map(k => otherUpdates[k]);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let updatedResource = resource;
        if (keys.length > 0) {
            const setString = keys.map((key, index) => `${key} = $${index + 1}`).join(', ');
            const res = await client.query(
                `UPDATE resources SET ${setString} WHERE id = $${keys.length + 1} AND org_id = $${keys.length + 2} RETURNING *`,
                [...values, resourceId, orgId]
            );
            updatedResource = res.rows[0];
        }

        let finalServiceIds = serviceIds;
        if (updateBody.serviceId) {
            finalServiceIds = serviceIds || [];
            if (!finalServiceIds.includes(updateBody.serviceId)) {
                finalServiceIds.push(updateBody.serviceId);
            }
        }

        if (finalServiceIds !== undefined) {
            // Sync services
            await client.query('DELETE FROM resource_services WHERE resource_id = $1', [resourceId]);
            if (Array.from(finalServiceIds).length > 0) {
                for (const serviceId of finalServiceIds) {
                    await client.query(
                        'INSERT INTO resource_services (resource_id, service_id) VALUES ($1, $2)',
                        [resourceId, serviceId]
                    );
                }
            }
        }

        await client.query('COMMIT');
        return updatedResource;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

const deleteResource = async (orgId, resourceId) => {
    await getResourceById(orgId, resourceId); // Validates existence and org ownership

    // Check if there are ANY appointments for this resource
    const apptCheck = await query('SELECT COUNT(*) FROM appointments WHERE resource_id = $1', [resourceId]);
    if (parseInt(apptCheck.rows[0].count) > 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, "you cant delete or modify the slot which have any appointment");
    }

    // Cascade delete slots associated with this resource
    await query('DELETE FROM slots WHERE resource_id = $1', [resourceId]);

    await query('DELETE FROM resources WHERE id = $1', [resourceId]);
};

/**
 * Link a resource to multiple services
 */
const linkResourceToServices = async (resourceId, serviceIds) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const serviceId of serviceIds) {
            await client.query(
                'INSERT INTO resource_services (resource_id, service_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [resourceId, serviceId]
            );
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

/**
 * Unlink a resource from a specific service
 */
const unlinkResourceFromService = async (resourceId, serviceId) => {
    await query(
        'DELETE FROM resource_services WHERE resource_id = $1 AND service_id = $2',
        [resourceId, serviceId]
    );
};

module.exports = {
    createResource,
    getResources,
    getResourcesByServiceId,
    getResourceById,
    updateResource,
    deleteResource,
    linkResourceToServices,
    unlinkResourceFromService
};
