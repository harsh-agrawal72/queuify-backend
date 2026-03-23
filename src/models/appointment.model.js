const { pool } = require('../config/db');

const createAppointment = async (appointmentBody) => {
    const { orgId, userId, serviceId, resourceId, slotId, pref_resource, pref_time, bypassDuplicate = false, customer_name, customer_phone } = appointmentBody;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 0. Prevent duplicate bookings for the same user and same slot (unless bypassed)
        if (slotId && !bypassDuplicate && userId) {
            const duplicateCheck = await client.query(
                `SELECT id FROM appointments 
                 WHERE user_id = $1 AND slot_id = $2 AND status IN ('confirmed', 'pending', 'serving')`,
                [userId, slotId]
            );
            if (duplicateCheck.rows.length > 0) {
                throw new Error("DUPLICATE_BOOKING_WARNING");
            }
        }

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
                    'SELECT * FROM slots WHERE id = $1 AND is_active = TRUE FOR UPDATE',
                    [slotId]
                );
                const slot = slotRes.rows[0];
                if (!slot) throw new Error('Slot not found or is inactive');

                // Overbooking prevention: Use concurrent_capacity if slot capacity is generic
                const maxCap = slot.max_capacity || resource.concurrent_capacity || 1;
                if (slot.booked_count >= maxCap) {
                    throw new Error('This session is fully booked (Capacity reached)');
                }
            }
        } else if (service.queue_type === 'STATIC' && slotId) {
            // CENTRAL STATIC queue slot check
            const slotRes = await client.query(
                'SELECT * FROM slots WHERE id = $1 AND is_active = TRUE FOR UPDATE',
                [slotId]
            );
            const slot = slotRes.rows[0];
            if (!slot) throw new Error('Slot not found or is inactive');
            if (slot.booked_count >= slot.max_capacity) {
                throw new Error('This session is fully booked');
            }
        }

        // Fetch slot start_time to set preferred_date (even if slotId is null later, we need the intended date)
        let preferredDate = null;
        if (slotId) {
            const slotInfo = await client.query('SELECT start_time FROM slots WHERE id = $1', [slotId]);
            if (slotInfo.rows.length > 0) {
                preferredDate = new Date(slotInfo.rows[0].start_time).toISOString().split('T')[0];
            }
        }

        const appointmentRes = await client.query(
            `INSERT INTO appointments (org_id, slot_id, user_id, service_id, resource_id, status, pref_resource, pref_time, preferred_date, customer_name, customer_phone) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [orgId, slotId || null, userId || null, serviceId, resourceId || null, 'confirmed', pref_resource || 'ANY', pref_time || 'FLEXIBLE', preferredDate, customer_name || null, customer_phone || null]
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
        // Partition logic depends on queue_scope and preferred_date
        let partitionBy, filterClause, filterParams;

        if (service.queue_scope === 'PER_RESOURCE') {
            partitionBy = 'service_id, resource_id, preferred_date, slot_id';
            filterClause = 'service_id = $1 AND resource_id = $2 AND preferred_date = $3 AND slot_id = $4';
            filterParams = [serviceId, resourceId, preferredDate, slotId];
        } else {
            // CENTRAL Queue: Shared across resources for the same intended date, but still partitioned by slot
            partitionBy = 'service_id, preferred_date, slot_id';
            filterClause = 'service_id = $1 AND preferred_date = $2 AND slot_id = $3';
            filterParams = [serviceId, preferredDate, slotId];
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
    try {
        const result = await pool.query(
            `SELECT a.*, 
                    s.name as service_name, s.queue_scope,
                    r.name as resource_name,
                    o.name as org_name, o.contact_email as org_contact_email, o.address as org_address,
                    u.name as user_name, u.email as user_email
            FROM appointments a
            LEFT JOIN services s ON a.service_id = s.id
            LEFT JOIN resources r ON a.resource_id = r.id
            LEFT JOIN organizations o ON a.org_id = o.id
            LEFT JOIN users u ON a.user_id = u.id
            WHERE a.id = $1::uuid`,
            [id]
        );
        return result.rows[0];
    } catch (err) {
        console.error(`[Model] getAppointmentById Error for ${id}:`, err.message);
        throw err;
    }
};

const getAppointmentsByUserId = async (userId) => {
    const result = await pool.query(
        `WITH QueueRanks AS (
            SELECT a.id, 
                   ROW_NUMBER() OVER (
                       PARTITION BY a.slot_id
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
                o.name as org_name, o.address as org_address,
                sl.start_time, sl.end_time,
                rv.id as review_id, rv.rating as review_rating
         FROM appointments a
         LEFT JOIN QueueRanks q ON a.id = q.id
         LEFT JOIN services s ON a.service_id = s.id
         LEFT JOIN organizations o ON a.org_id = o.id
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
                       PARTITION BY a.slot_id
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
    let query = 'UPDATE appointments SET status = $1';
    const params = [status, id];

    if (status === 'serving') {
        query += ', serving_started_at = NOW()';
    } else if (status === 'completed') {
        query += ', completed_at = NOW()';
    }

    query += ' WHERE id = $2 RETURNING *';

    const result = await pool.query(query, params);
    return result.rows[0];
};

const cancelAppointment = async (id, userId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const apptRes = await client.query(
            'SELECT * FROM appointments WHERE id = $1 AND user_id = $2 FOR UPDATE',
            [id, userId]
        );

        if (apptRes.rows.length === 0) throw new Error('Appointment not found');
        const appt = apptRes.rows[0];
        if (appt.status === 'cancelled') throw new Error('Already cancelled');

        await client.query(
            "UPDATE appointments SET status = 'cancelled', cancelled_by = 'user' WHERE id = $1",
            [id]
        );

        // Decrement booked count
        if (appt.slot_id) {
            await client.query(
                'UPDATE slots SET booked_count = GREATEST(booked_count - 1, 0) WHERE id = $1',
                [appt.slot_id]
            );
        }

        await client.query('COMMIT');
        return { ...appt, status: 'cancelled' };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

const rescheduleAppointment = async (appointmentId, userId, newSlotId, isAdmin = false, orgId = null) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch and Lock existing appointment
        let apptRes;
        if (isAdmin) {
            apptRes = await client.query(
                'SELECT * FROM appointments WHERE id = $1 AND org_id = $2 FOR UPDATE',
                [appointmentId, orgId]
            );
        } else {
            apptRes = await client.query(
                'SELECT * FROM appointments WHERE id = $1 AND user_id = $2 FOR UPDATE',
                [appointmentId, userId]
            );
        }
        if (apptRes.rows.length === 0) throw new Error('Appointment not found');
        const appt = apptRes.rows[0];

        if (!['pending', 'confirmed'].includes(appt.status)) {
            throw new Error(`Cannot reschedule appointment in ${appt.status} status`);
        }

        if (appt.slot_id === newSlotId) {
            throw new Error('Already booked for this slot');
        }

        // 2. Fetch and Lock new slot
        const slotRes = await client.query(
            'SELECT * FROM slots WHERE id = $1 AND is_active = TRUE FOR UPDATE',
            [newSlotId]
        );
        const newSlot = slotRes.rows[0];
        if (!newSlot) throw new Error('New slot not found or inactive');

        // 3. Service Verification
        if (newSlot.service_id !== appt.service_id) {
            throw new Error('Cannot reschedule to a different service');
        }

        // 4. Capacity Check
        if (newSlot.booked_count >= newSlot.max_capacity) {
            throw new Error('New slot is fully booked');
        }

        // 5. Decrement old slot occupancy
        if (appt.slot_id) {
            await client.query(
                'UPDATE slots SET booked_count = GREATEST(booked_count - 1, 0) WHERE id = $1',
                [appt.slot_id]
            );
        }

        // 6. Increment new slot occupancy
        await client.query(
            'UPDATE slots SET booked_count = booked_count + 1 WHERE id = $1',
            [newSlotId]
        );

        const newPreferredDate = new Date(newSlot.start_time).toISOString().split('T')[0];

        // 7. Update Appointment
        const updatedApptRes = await client.query(
            `UPDATE appointments 
             SET slot_id = $1, resource_id = $2, preferred_date = $3, created_at = NOW() 
             WHERE id = $4 RETURNING *`,
            [newSlotId, newSlot.resource_id, newPreferredDate, appointmentId]
        );
        const updatedAppt = updatedApptRes.rows[0];

        // 8. Calculate New Rank
        const svcRes = await client.query('SELECT queue_scope FROM services WHERE id = $1', [appt.service_id]);
        const service = svcRes.rows[0];

        let partitionBy, filterClause, filterParams;
        if (service.queue_scope === 'PER_RESOURCE') {
            partitionBy = 'service_id, resource_id, preferred_date, slot_id';
            filterClause = 'service_id = $1 AND resource_id = $2 AND preferred_date = $3 AND slot_id = $4';
            filterParams = [updatedAppt.service_id, updatedAppt.resource_id, newPreferredDate, newSlotId];
        } else {
            partitionBy = 'service_id, preferred_date, slot_id';
            filterClause = 'service_id = $1 AND preferred_date = $2 AND slot_id = $3';
            filterParams = [updatedAppt.service_id, newPreferredDate, newSlotId];
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
            appointment: updatedAppt,
            queue_number: rank
        };
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error in rescheduleAppointment:', e);
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
