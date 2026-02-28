const { pool } = require('../config/db');

const createAppointment = async (appointmentBody) => {
    const { orgId, userId, serviceId, resourceId, slotId } = appointmentBody;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Fetch service details and LOCK the service row
        const svcRes = await client.query(
            'SELECT * FROM services WHERE id = $1 AND org_id = $2 FOR UPDATE',
            [serviceId, orgId]
        );
        if (svcRes.rows.length === 0) throw new Error('Service not found');
        const service = svcRes.rows[0];

        // 2. Concurrency: Respect concurrent_capacity for PER_RESOURCE
        if (service.queue_scope === 'PER_RESOURCE') {
            if (!resourceId) throw new Error('Resource ID is required for resource-scoped queues');

            // LOCK the resource row
            const resLock = await client.query(
                'SELECT id, concurrent_capacity FROM resources WHERE id = $1 FOR UPDATE',
                [resourceId]
            );
            if (resLock.rows.length === 0) throw new Error('Resource not found');
            const resource = resLock.rows[0];

            // If STATIC, we must ensure we don't exceed capacity for the given slot
            if (service.queue_type === 'STATIC' && slotId) {
                const slotRes = await client.query(
                    'SELECT * FROM slots WHERE id = $1 FOR UPDATE',
                    [slotId]
                );
                const slot = slotRes.rows[0];
                if (!slot) throw new Error('Slot not found');

                // Overbooking prevention: Use concurrent_capacity if slot capacity is generic
                const maxCap = slot.max_capacity || resource.concurrent_capacity || 1;
                if (slot.booked_count >= maxCap) {
                    throw new Error('This session is fully booked (Capacity reached)');
                }
            }
        } else if (service.queue_type === 'STATIC' && slotId) {
            // CENTRAL STATIC queue slot check
            const slotRes = await client.query(
                'SELECT * FROM slots WHERE id = $1 FOR UPDATE',
                [slotId]
            );
            const slot = slotRes.rows[0];
            if (!slot) throw new Error('Slot not found');
            if (slot.booked_count >= slot.max_capacity) {
                throw new Error('This session is fully booked');
            }
        }

        // 3. Create appointment
        const appointmentRes = await client.query(
            `INSERT INTO appointments (
                org_id, slot_id, user_id, service_id, resource_id, 
                status
            ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [orgId, slotId || null, userId, serviceId, resourceId || null, 'confirmed']
        );

        const appointmentId = appointmentRes.rows[0].id;

        // 4. Update slot booked count if applicable
        if (slotId) {
            await client.query(
                'UPDATE slots SET booked_count = booked_count + 1 WHERE id = $1',
                [slotId]
            );
        }

        // 5. Calculate Dynamic Rank (Queue Number)
        // Partition logic depends on queue_scope
        let partitionBy, filterClause, filterParams;

        if (service.queue_scope === 'PER_RESOURCE') {
            partitionBy = slotId ? 'slot_id' : 'service_id, resource_id, DATE(created_at)';
            filterClause = slotId ? 'slot_id = $1' : 'service_id = $1 AND resource_id = $2 AND DATE(created_at) = CURRENT_DATE';
            filterParams = slotId ? [slotId] : [serviceId, resourceId];
        } else {
            // CENTRAL Queue: Shared across resources for same time/slot
            if (slotId) {
                // Get slot start time for stable partitioning across resources
                const { rows: [slotInfo] } = await client.query('SELECT start_time FROM slots WHERE id = $1', [slotId]);
                partitionBy = 'service_id, (SELECT start_time FROM slots WHERE id = slot_id)';
                filterClause = 'service_id = $1 AND (SELECT start_time FROM slots WHERE id = slot_id) = $2';
                filterParams = [serviceId, slotInfo.start_time];
            } else {
                partitionBy = 'service_id, DATE(created_at)';
                filterClause = 'service_id = $1 AND DATE(created_at) = CURRENT_DATE';
                filterParams = [serviceId];
            }
        }

        const queueRes = await client.query(
            `WITH RankedQueue AS (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY ${partitionBy} ORDER BY created_at ASC) as q_rank
                FROM appointments
                WHERE status IN ('pending', 'confirmed', 'serving', 'completed')
                AND ${filterClause}
             )
             SELECT q_rank FROM RankedQueue WHERE id = $${filterParams.length + 1}`,
            [...filterParams, appointmentId]
        );

        const rank = queueRes.rows.length > 0 ? parseInt(queueRes.rows[0].q_rank) : 0;

        await client.query('COMMIT');

        return {
            appointment: appointmentRes.rows[0],
            queue_number: rank
        };

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error in createAppointment:', e);
        throw e;
    } finally {
        client.release();
    }
};

const getAppointmentById = async (id) => {
    const result = await pool.query(
        `WITH QueueRanks AS (
            SELECT a.id, 
                   ROW_NUMBER() OVER (
                       PARTITION BY (
                           CASE 
                               WHEN s.queue_scope = 'PER_RESOURCE' THEN a.slot_id::text 
                               ELSE (SELECT CONCAT(a.service_id, '_', sl.start_time) FROM slots sl WHERE sl.id = a.slot_id)
                           END
                       )
                       ORDER BY a.created_at ASC
                   ) as calculated_queue
            FROM appointments a
            JOIN services s ON a.service_id = s.id
            WHERE a.status IN ('pending', 'confirmed', 'serving', 'completed')
         )
         SELECT a.*, 
                COALESCE(q.calculated_queue, 0) as queue_number,
                s.name as service_name, s.queue_scope,
                r.name as resource_name
         FROM appointments a
         LEFT JOIN QueueRanks q ON a.id = q.id
         JOIN services s ON a.service_id = s.id
         LEFT JOIN resources r ON a.resource_id = r.id
         WHERE a.id = $1`,
        [id]
    );
    return result.rows[0];
};

const getAppointmentsByUserId = async (userId) => {
    const result = await pool.query(
        `WITH QueueRanks AS (
            SELECT a.id, 
                   ROW_NUMBER() OVER (
                       PARTITION BY (
                           CASE 
                               WHEN s.queue_scope = 'PER_RESOURCE' THEN a.slot_id::text 
                               ELSE (SELECT CONCAT(a.service_id, '_', sl.start_time) FROM slots sl WHERE sl.id = a.slot_id)
                           END
                       )
                       ORDER BY a.created_at ASC
                   ) as calculated_queue
            FROM appointments a
            JOIN services s ON a.service_id = s.id
            WHERE a.status IN ('pending', 'confirmed', 'serving', 'completed')
         )
         SELECT a.*, 
                s.org_id,
                COALESCE(q.calculated_queue, 0) as queue_number,
                s.name as service_name, r.name as resource_name,
                sl.start_time, sl.end_time,
                rv.id as review_id, rv.rating as review_rating
         FROM appointments a
         LEFT JOIN QueueRanks q ON a.id = q.id
         LEFT JOIN services s ON a.service_id = s.id
         LEFT JOIN resources r ON a.resource_id = r.id
         LEFT JOIN slots sl ON a.slot_id = sl.id
         LEFT JOIN reviews rv ON a.id = rv.appointment_id
         WHERE a.user_id = $1 
         ORDER BY a.created_at DESC`,
        [userId]
    );
    return result.rows;
};

const getAppointmentsByOrgId = async (orgId) => {
    const result = await pool.query(
        `WITH QueueRanks AS (
            SELECT a.id, 
                   ROW_NUMBER() OVER (
                       PARTITION BY (
                           CASE 
                               WHEN s.queue_scope = 'PER_RESOURCE' THEN a.slot_id::text 
                               ELSE (SELECT CONCAT(a.service_id, '_', sl.start_time) FROM slots sl WHERE sl.id = a.slot_id)
                           END
                       )
                       ORDER BY a.created_at ASC
                   ) as calculated_queue
            FROM appointments a
            JOIN services s ON a.service_id = s.id
            WHERE a.status IN ('pending', 'confirmed', 'serving', 'completed')
         )
         SELECT a.*, 
                COALESCE(q.calculated_queue, 0) as queue_number,
                u.name as user_name, u.email as user_email,
                s.name as service_name, r.name as resource_name,
                sl.start_time, sl.end_time,
                rv.id as review_id, rv.rating as review_rating
         FROM appointments a
         LEFT JOIN QueueRanks q ON a.id = q.id
         LEFT JOIN users u ON a.user_id = u.id
         LEFT JOIN services s ON a.service_id = s.id
         LEFT JOIN resources r ON a.resource_id = r.id
         LEFT JOIN slots sl ON a.slot_id = sl.id
         LEFT JOIN reviews rv ON a.id = rv.appointment_id
         WHERE a.org_id = $1
         ORDER BY a.created_at DESC`,
        [orgId]
    );
    return result.rows;
};

const updateAppointmentStatus = async (id, status) => {
    const result = await pool.query(
        `UPDATE appointments SET status = $1 WHERE id = $2 RETURNING *`,
        [status, id]
    );
    return result.rows[0];
};

const cancelAppointment = async (id, userId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const appt = await client.query(
            'SELECT * FROM appointments WHERE id = $1 AND user_id = $2',
            [id, userId]
        );

        if (appt.rows.length === 0) throw new Error('Appointment not found');
        if (appt.rows[0].status === 'cancelled') throw new Error('Already cancelled');

        await client.query(
            "UPDATE appointments SET status = 'cancelled', cancelled_by = 'user' WHERE id = $1",
            [id]
        );

        // Decrement booked count
        await client.query(
            'UPDATE slots SET booked_count = GREATEST(booked_count - 1, 0) WHERE id = $1',
            [appt.rows[0].slot_id]
        );

        await client.query('COMMIT');
        return { ...appt.rows[0], status: 'cancelled' };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

module.exports = {
    createAppointment,
    getAppointmentById,
    getAppointmentsByUserId,
    getAppointmentsByOrgId,
    updateAppointmentStatus,
    cancelAppointment,
    pool
};
