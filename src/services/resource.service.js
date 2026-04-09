const { query, pool } = require('../config/db');
const httpStatus = require('../utils/httpStatus');
const ApiError = require('../utils/ApiError');

const createResource = async (orgId, resourceBody) => {
    const { name, type, description, concurrent_capacity, is_active, serviceIds } = resourceBody;

    // Check plan limits
    const orgRes = await pool.query(
        `SELECT o.plan_id, p.features 
         FROM organizations o 
         JOIN plans p ON o.plan_id = p.id 
         WHERE o.id = $1`, 
        [orgId]
    );

    if (orgRes.rows.length > 0) {
        const features = orgRes.rows[0].features || {};
        const maxResources = features.max_resources || 1; // Default to Free limit

        const countRes = await pool.query(
            'SELECT COUNT(*) FROM resources WHERE org_id = $1 AND is_active = TRUE',
            [orgId]
        );
        const currentCount = parseInt(countRes.rows[0].count);

        if (currentCount >= maxResources) {
            throw new ApiError(httpStatus.FORBIDDEN, `Your current plan allows only ${maxResources} resources. Please upgrade for more.`);
        }
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const res = await client.query(
            `INSERT INTO resources (org_id, name, type, description, concurrent_capacity, is_active)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [orgId, name, type || 'staff', description, concurrent_capacity || 1, is_active !== false]
        );
        const resource = res.rows[0];

        let allServiceIds = serviceIds || [];
        if (resourceBody.serviceId && !allServiceIds.includes(resourceBody.serviceId)) {
            allServiceIds.push(resourceBody.serviceId);
        }

        if (allServiceIds.length > 0) {
            for (const serviceItem of allServiceIds) {
                // Support both simple ID array or array of objects { id, price }
                const serviceId = typeof serviceItem === 'object' ? serviceItem.id : serviceItem;
                const price = typeof serviceItem === 'object' ? serviceItem.price : 0;
                
                await client.query(
                    'INSERT INTO resource_services (resource_id, service_id, price) VALUES ($1, $2, $3)',
                    [resource.id, serviceId, price || 0]
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

const getResourcesByServiceId = async (serviceId) => {
    let sql = `
        SELECT r.*, rs.price 
        FROM resources r
        JOIN resource_services rs ON r.id = rs.resource_id
        WHERE rs.service_id = $1 AND r.is_active = TRUE
        ORDER BY r.created_at DESC
    `;
    const res = await query(sql, [serviceId]);
    return res.rows;
};

const getResources = async (orgId, publicOnly = false) => {
    let sql = `
        SELECT r.*, 
               COALESCE(
                 json_agg(
                   json_build_object('id', rs.service_id, 'price', rs.price)
                 ) FILTER (WHERE rs.service_id IS NOT NULL AND s.is_active = TRUE), '[]'
               ) as service_mappings
        FROM resources r
        LEFT JOIN resource_services rs ON r.id = rs.resource_id
        LEFT JOIN services s ON rs.service_id = s.id
        WHERE r.org_id = $1 AND r.is_active = TRUE
        GROUP BY r.id 
        ORDER BY r.created_at DESC
    `;
    const res = await query(sql, [orgId]);
    return res.rows;
};

const getResourceById = async (orgId, resourceId) => {
    const res = await query(`
        SELECT r.*, 
               COALESCE(
                 json_agg(
                   json_build_object('id', rs.service_id, 'price', rs.price)
                 ) FILTER (WHERE rs.service_id IS NOT NULL AND s.is_active = TRUE), '[]'
               ) as service_mappings
        FROM resources r
        LEFT JOIN resource_services rs ON r.id = rs.resource_id
        LEFT JOIN services s ON rs.service_id = s.id
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
            const serviceArray = Array.from(finalServiceIds);
            if (serviceArray.length > 0) {
                for (const serviceItem of serviceArray) {
                    const serviceId = typeof serviceItem === 'object' ? serviceItem.id : serviceItem;
                    const price = typeof serviceItem === 'object' ? serviceItem.price : 0;
                    
                    await client.query(
                        'INSERT INTO resource_services (resource_id, service_id, price) VALUES ($1, $2, $3)',
                        [resourceId, serviceId, price || 0]
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

    /* 
    // Blocked: We now allow deactivating a resource even if it has active appointments. 
    // The resource remains in the DB for reference but won't be bookable for new ones.
    const activeApptCheck = await query(
        `SELECT COUNT(*) FROM appointments 
         WHERE resource_id = $1 AND status IN ('confirmed', 'pending', 'booked', 'serving')`, 
        [resourceId]
    );
    
    if (parseInt(activeApptCheck.rows[0].count) > 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, "You cannot delete a resource that has active (confirmed/pending) appointments. Please complete/cancel them first.");
    }
    */

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Mark resource as inactive (Soft Delete)
        const updateRes = await client.query(
            'UPDATE resources SET is_active = FALSE WHERE id = $1 AND org_id = $2', 
            [resourceId, orgId]
        );

        if (updateRes.rowCount === 0) {
            throw new ApiError(httpStatus.NOT_FOUND, 'Resource not found or already deleted');
        }

        // 2. Mark associated slots as inactive (Soft Delete)
        await client.query('UPDATE slots SET is_active = FALSE WHERE resource_id = $1', [resourceId]);

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        // Wrap error for production visibility if it's a database error
        if (!(e instanceof ApiError)) {
            throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Database error during resource deletion: ${e.message}`, true, e.stack);
        }
        throw e;
    } finally {
        client.release();
    }
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
