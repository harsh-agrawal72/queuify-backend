const { pool } = require('../config/db');
const httpStatus = require('../utils/httpStatus');
const ApiError = require('../utils/ApiError');
const { calculatePaymentBreakdown } = require('../utils/paymentHelper');

const createAppointment = async (appointmentBody) => {
    const { orgId, userId, serviceId, resourceId, slotId, pref_resource, pref_time, bypassDuplicate = false, customer_name, customer_phone } = appointmentBody;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 0. Broad Duplicate Check: Prevent multiple active bookings for same user/service on same day
        const dayCheckDate = slotId 
            ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date((await client.query('SELECT start_time FROM slots WHERE id = $1', [slotId])).rows[0]?.start_time || new Date()))
            : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

        const broadCheck = await client.query(
            `SELECT id, status, slot_id 
             FROM appointments 
             WHERE user_id = $1 AND service_id = $2 AND preferred_date = $3 AND status != 'cancelled'`,
            [userId, serviceId, dayCheckDate]
        );

        if (broadCheck.rows.length > 0 && !bypassDuplicate) {
            const existing = broadCheck.rows[0];
            
            // 1. If it's pure duplicate (same slot or same day active), block
            if (['confirmed', 'pending', 'serving'].includes(existing.status)) {
                throw new Error("DUPLICATE_BOOKING_WARNING");
            }
            
            // 2. If it's pending_payment for THE SAME SLOT, we can resume it
            if (existing.status === 'pending_payment' && existing.slot_id === slotId) {
                // (Existing logic to resume payment)
                const preferredDateRes = await client.query('SELECT start_time FROM slots WHERE id = $1', [slotId]);
                const preferredDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(preferredDateRes.rows[0].start_time));
                const serviceRes = await client.query('SELECT queue_scope FROM services WHERE id = $1', [serviceId]);
                const service = serviceRes.rows[0];

                let partitionBy, filterClause, filterParams;
                if (service.queue_scope === 'PER_RESOURCE') {
                    partitionBy = 'service_id, resource_id, preferred_date, slot_id';
                    filterClause = 'service_id = $1 AND resource_id = $2 AND preferred_date = $3 AND slot_id = $4';
                    filterParams = [serviceId, resourceId, preferredDate, slotId];
                } else {
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
                    [...filterParams, existing.id]
                );

                const rank = queueRes.rows.length > 0 ? parseInt(queueRes.rows[0].q_rank) : 0;
                await client.query('COMMIT');
                return { appointment: existing, queue_number: rank };
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
            if (!resourceId) throw new ApiError(httpStatus.BAD_REQUEST, 'Resource ID is required for resource-scoped queues');

            // LOCK the resource row
            const resLock = await client.query(
                'SELECT id, concurrent_capacity FROM resources WHERE id = $1 FOR UPDATE',
                [resourceId]
            );
            if (resLock.rows.length === 0) throw new ApiError(httpStatus.NOT_FOUND, 'Resource not found');
            const resource = resLock.rows[0];

            // If STATIC, we must ensure we don't exceed capacity for the given slot
            if (service.queue_type === 'STATIC' && slotId) {
                const slotRes = await client.query(
                    'SELECT * FROM slots WHERE id = $1 AND is_active = TRUE FOR UPDATE',
                    [slotId]
                );
                const slot = slotRes.rows[0];
                if (!slot) throw new ApiError(httpStatus.NOT_FOUND, 'Slot not found or is inactive');

                // Overbooking prevention: Use concurrent_capacity if slot capacity is generic
                const maxCap = slot.max_capacity || resource.concurrent_capacity || 1;
                if (slot.booked_count >= maxCap) {
                    throw new ApiError(httpStatus.BAD_REQUEST, 'This session is fully booked (Capacity reached)');
                }
            }
        } else if (service.queue_type === 'STATIC' && slotId) {
            // CENTRAL STATIC queue slot check
            const slotRes = await client.query(
                'SELECT * FROM slots WHERE id = $1 AND is_active = TRUE FOR UPDATE',
                [slotId]
            );
            const slot = slotRes.rows[0];
            if (!slot) throw new ApiError(httpStatus.NOT_FOUND, 'Slot not found or is inactive');
            if (slot.booked_count >= slot.max_capacity) {
                throw new ApiError(httpStatus.BAD_REQUEST, 'This session is fully booked');
            }
        }

        // Fetch slot start_time to set preferred_date (even if slotId is null later, we need the intended date)
        let preferredDate = null;
        if (slotId) {
            const slotInfo = await client.query('SELECT start_time FROM slots WHERE id = $1', [slotId]);
            if (slotInfo.rows.length > 0) {
                preferredDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(slotInfo.rows[0].start_time));
            }
        } else {
            // Default to today for manual walk-ins / unassigned entries
            preferredDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
        }

        // 3. Dynamic Column Detection for Resilience
        const apptTableCheck = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'appointments'
        `);
        const existingCols = apptTableCheck.rows.map(r => r.column_name);

        // Generate 4-digit OTP code
        const otpCode = Math.floor(1000 + Math.random() * 9000).toString();

        const columns = ['org_id', 'slot_id', 'user_id', 'service_id', 'resource_id', 'status', 'pref_resource', 'pref_time', 'preferred_date'];
        const values = [orgId, slotId || null, userId || null, serviceId, resourceId || null, slotId ? 'confirmed' : 'pending', pref_resource || 'ANY', pref_time || 'FLEXIBLE', preferredDate];
        const valuePlaceholders = ['$1', '$2', '$3', '$4', '$5', '$6', '$7', '$8', '$9'];

        // Add Automated Payment Columns
        if (existingCols.includes('otp_code')) {
            columns.push('otp_code');
            values.push(otpCode);
            valuePlaceholders.push(`$${values.length}`);
        }

        // Fetch Price from Mapping (with fallback to Resource Price then Service Base Price)
        if (existingCols.includes('price')) {
            let price = 0;
            
            if (resourceId) {
                // 1. Check for specific Service + Resource combo price
                const rsPriceRes = await client.query(
                    'SELECT price FROM resource_services WHERE resource_id = $1 AND service_id = $2',
                    [resourceId, serviceId]
                );
                
                if (rsPriceRes.rows.length > 0 && parseFloat(rsPriceRes.rows[0].price) > 0) {
                    price = rsPriceRes.rows[0].price;
                } else {
                    // 2. Check for general Resource price
                    const rPriceRes = await client.query('SELECT price FROM resources WHERE id = $1', [resourceId]);
                    if (rPriceRes.rows.length > 0 && parseFloat(rPriceRes.rows[0].price) > 0) {
                        price = rPriceRes.rows[0].price;
                    } else {
                        // 3. Fallback to Service Base Price
                        const svcPrice = await client.query('SELECT price FROM services WHERE id = $1', [serviceId]);
                        price = svcPrice.rows[0]?.price || 0;
                    }
                }
            } else {
                // Central/Any fallback - check Service Base Price
                const svcPrice = await client.query('SELECT price FROM services WHERE id = $1', [serviceId]);
                price = svcPrice.rows[0]?.price || 0;
            }

            columns.push('price');
            values.push(price);
            valuePlaceholders.push(`$${values.length}`);

            // Calculate and store payment fee breakdown
            const breakdown = calculatePaymentBreakdown(price);
            if (breakdown.totalPayable > 0) {
                if (existingCols.includes('platform_fee')) {
                    columns.push('platform_fee');
                    values.push(breakdown.platformFee);
                    valuePlaceholders.push(`$${values.length}`);
                }
                if (existingCols.includes('transaction_fee')) {
                    columns.push('transaction_fee');
                    values.push(breakdown.transactionFee);
                    valuePlaceholders.push(`$${values.length}`);
                }
                if (existingCols.includes('payment_gst')) {
                    columns.push('payment_gst');
                    values.push(breakdown.paymentGst);
                    valuePlaceholders.push(`$${values.length}`);
                }
                if (existingCols.includes('total_payable')) {
                    columns.push('total_payable');
                    values.push(breakdown.totalPayable);
                    valuePlaceholders.push(`$${values.length}`);
                }
            }
        }

        // Add optional/new columns if they exist in the DB
        if (existingCols.includes('customer_name')) {
            columns.push('customer_name');
            values.push(customer_name || null);
            valuePlaceholders.push(`$${values.length}`);
        }
        if (existingCols.includes('customer_phone')) {
            columns.push('customer_phone');
            values.push(customer_phone || null);
            valuePlaceholders.push(`$${values.length}`);
        }
        if (existingCols.includes('token_number')) {
            columns.push('token_number');
            values.push(appointmentBody.token_number || null);
            valuePlaceholders.push(`$${values.length}`);
        }

        const appointmentRes = await client.query(
            `INSERT INTO appointments (${columns.join(', ')}) 
             VALUES (${valuePlaceholders.join(', ')}) RETURNING *`,
            values
        );

        const appointmentId = appointmentRes.rows[0].id;

        // 4. Update slot booked count if applicable
        if (slotId) {
            // For manual/admin appointments, we allow overbooking by expanding capacity if needed
            if (bypassDuplicate) {
                await client.query(
                    'UPDATE slots SET booked_count = booked_count + 1, max_capacity = GREATEST(max_capacity, booked_count + 1) WHERE id = $1',
                    [slotId]
                );
            } else {
                await client.query(
                    'UPDATE slots SET booked_count = booked_count + 1 WHERE id = $1',
                    [slotId]
                );
            }
        }

        // 5. Calculate Dynamic Rank (Queue Number)
        // Partition logic depends on queue_scope and preferred_date
        let partitionBy, filterClause, filterParams;

        if (service.queue_scope === 'PER_RESOURCE') {
            partitionBy = 'service_id, resource_id, preferred_date, slot_id';
            filterClause = 'service_id = $1 AND resource_id = $2 AND preferred_date = $3 AND (slot_id = $4 OR ($4::uuid IS NULL AND slot_id IS NULL))';
            filterParams = [serviceId, resourceId, preferredDate, slotId || null];
        } else {
            // CENTRAL Queue: Shared across resources for the same intended date, but still partitioned by slot
            partitionBy = 'service_id, preferred_date, slot_id';
            filterClause = 'service_id = $1 AND preferred_date = $2 AND (slot_id = $3 OR ($3::uuid IS NULL AND slot_id IS NULL))';
            filterParams = [serviceId, preferredDate, slotId || null];
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
                     o.name as org_name, o.contact_email as org_contact_email, o.contact_phone as org_contact_phone,
                     COALESCE(p.address, o.address) as org_address, p.city as org_city, p.state as org_state, p.pincode as org_pincode, 
                     logo.image_url as org_logo_url,
                     u.name as user_name, u.email as user_email,
                     sl.start_time, sl.end_time, a.reschedule_count,
                     a.proposed_slot_id, a.reschedule_status, a.reschedule_reason, a.is_priority,
                     psl.start_time as proposed_start_time, psl.end_time as proposed_end_time
             FROM appointments a
             LEFT JOIN services s ON a.service_id = s.id
             LEFT JOIN resources r ON a.resource_id = r.id
             LEFT JOIN organizations o ON a.org_id = o.id
             LEFT JOIN organization_profiles p ON o.id = p.org_id
             LEFT JOIN (
                SELECT org_id, image_url FROM organization_images WHERE image_type = 'logo'
             ) logo ON o.id = logo.org_id
             LEFT JOIN users u ON a.user_id = u.id
             LEFT JOIN slots sl ON a.slot_id = sl.id
             LEFT JOIN slots psl ON a.proposed_slot_id = psl.id
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
         ),
         QueueMetadata AS (
            SELECT a.slot_id,
                   MIN(q.calculated_queue) FILTER (WHERE a.status = 'serving') as serving_token,
                   COUNT(*) FILTER (WHERE a.status IN ('confirmed', 'pending', 'serving')) as total_active
            FROM appointments a
            JOIN QueueRanks q ON a.id = q.id
            GROUP BY a.slot_id
         )
         SELECT a.*, 
                COALESCE(q.calculated_queue, 0) as live_queue_number,
                COALESCE((
                    SELECT COUNT(*) 
                    FROM appointments a2
                    JOIN QueueRanks q2 ON a2.id = q2.id
                    WHERE a2.slot_id IS NOT DISTINCT FROM a.slot_id 
                      AND a2.status IN ('confirmed', 'pending', 'serving')
                      AND q2.calculated_queue < q.calculated_queue
                ), 0) as people_ahead,
                qm.serving_token,
                qm.total_active as total_in_slot,
                s.name as service_name, s.estimated_service_time, r.name as resource_name,
                o.name as org_name, COALESCE(p.address, o.address) as org_address, p.city as org_city, p.state as org_state, p.pincode as org_pincode, o.phone as org_contact_phone, o.contact_email as org_contact_email, logo.image_url as org_logo_url,
                sl.start_time, sl.end_time, a.reschedule_count,
                a.proposed_slot_id, a.reschedule_status, a.reschedule_reason, a.is_priority,
                psl.start_time as proposed_start_time, psl.end_time as proposed_end_time,
                rv.id as review_id, rv.rating as review_rating
         FROM appointments a
         LEFT JOIN QueueRanks q ON a.id = q.id
         LEFT JOIN QueueMetadata qm ON a.slot_id = qm.slot_id
         LEFT JOIN services s ON a.service_id = s.id
         LEFT JOIN organizations o ON a.org_id = o.id
         LEFT JOIN organization_profiles p ON o.id = p.org_id
         LEFT JOIN (
            SELECT org_id, image_url FROM organization_images WHERE image_type = 'logo'
         ) logo ON o.id = logo.org_id
         LEFT JOIN resources r ON a.resource_id = r.id
         LEFT JOIN slots sl ON a.slot_id = sl.id
         LEFT JOIN slots psl ON a.proposed_slot_id = psl.id
         LEFT JOIN reviews rv ON a.id = rv.appointment_id
         WHERE a.user_id = $1::uuid 
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
                COALESCE(q.calculated_queue, 0) as live_queue_number,
                u.name as user_name, u.email as user_email,
                s.name as service_name, r.name as resource_name,
                o.name as org_name, COALESCE(p.address, o.address) as org_address, p.city as org_city, p.state as org_state, p.pincode as org_pincode, o.phone as org_contact_phone, o.contact_email as org_contact_email, logo.image_url as org_logo_url,
                sl.start_time, sl.end_time, a.reschedule_count,
                a.proposed_slot_id, a.reschedule_status, a.reschedule_reason, a.is_priority,
                psl.start_time as proposed_start_time, psl.end_time as proposed_end_time,
                rv.id as review_id, rv.rating as review_rating
         FROM appointments a
         LEFT JOIN QueueRanks q ON a.id = q.id
         LEFT JOIN users u ON a.user_id = u.id
         LEFT JOIN services s ON a.service_id = s.id
         LEFT JOIN organizations o ON a.org_id = o.id
         LEFT JOIN organization_profiles p ON o.id = p.org_id
         LEFT JOIN (
            SELECT org_id, image_url FROM organization_images WHERE image_type = 'logo'
         ) logo ON o.id = logo.org_id
         LEFT JOIN resources r ON a.resource_id = r.id
         LEFT JOIN slots sl ON a.slot_id = sl.id
         LEFT JOIN slots psl ON a.proposed_slot_id = psl.id
         LEFT JOIN reviews rv ON a.id = rv.appointment_id
         WHERE a.org_id = $1::uuid
         ORDER BY a.created_at DESC`,
        [orgId]
    );
    return result.rows;
};

const updateAppointmentStatus = async (id, status, admin_remarks = null) => {
    let query = 'UPDATE appointments SET status = $1';
    const params = [status, id];

    if (status === 'serving') {
        query += ', serving_started_at = NOW()';
    } else if (status === 'completed') {
        query += ', completed_at = NOW()';
        if (admin_remarks) {
            params.push(admin_remarks);
            query += `, admin_remarks = $${params.length}`;
        }
    }

    query += ' WHERE id = $2 RETURNING *';

    const result = await pool.query(query, params);
    return result.rows[0];
};

const cancelAppointment = async (id, userId, reason = null) => {
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

        console.log(`[Model-Cancel] Attempting to cancel appt=${id} for user=${userId}`);
        const updateRes = await client.query(
            "UPDATE appointments SET status = 'cancelled', cancelled_by = 'user', cancellation_reason = $1 WHERE id = $2 RETURNING *",
            [reason, id]
        );

        if (updateRes.rowCount === 0) {
            console.error(`[Model-Cancel] Row NOT updated for appt=${id}. Target row might have changed or ID is wrong?`);
            throw new Error('Update failed');
        }

        const updatedAppt = updateRes.rows[0];
        console.log(`[Model-Cancel] Success: appt=${id} status is now ${updatedAppt.status}`);

        // Decrement booked count
        if (appt.slot_id) {
            await client.query(
                'UPDATE slots SET booked_count = GREATEST(booked_count - 1, 0) WHERE id = $1',
                [appt.slot_id]
            );
        }

        await client.query('COMMIT');
        return updatedAppt;
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

        if (!['pending', 'confirmed', 'waitlisted_urgent'].includes(appt.status)) {
            throw new Error(`Cannot reschedule appointment in ${appt.status} status`);
        }

        if (!isAdmin && appt.reschedule_count >= 1) {
            throw new Error('This appointment has already been rescheduled once and cannot be moved again');
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
        // If the slot has a specific service_id, it MUST match.
        // If not, we must verify the resource provides this service.
        if (newSlot.service_id && newSlot.service_id !== appt.service_id) {
            throw new Error('Cannot reschedule to a different service');
        }

        const compatibilityCheck = await client.query(
            `SELECT 1 FROM resource_services 
             WHERE resource_id = $1 AND service_id = $2`,
            [newSlot.resource_id, appt.service_id]
        );

        if (compatibilityCheck.rows.length === 0 && newSlot.service_id !== appt.service_id) {
            throw new Error('This professional does not provide the required service for this appointment');
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

        const newPreferredDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(newSlot.start_time));

        // 7. Update Appointment
        const updatedApptRes = await client.query(
            `UPDATE appointments 
             SET slot_id = $1, resource_id = $2, preferred_date = $3, created_at = NOW(),
                 reschedule_count = reschedule_count + 1 
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
            queue_number: rank,
            oldSlotId: appt.slot_id
        };
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error in rescheduleAppointment:', e);
        throw e;
    } finally {
        client.release();
    }
};

const proposeReschedule = async (appointmentId, orgId, proposedSlotId, reason) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Ensure slot exists and belongs to the same org/service
        const slotRes = await client.query('SELECT service_id, org_id FROM slots WHERE id = $1', [proposedSlotId]);
        if (slotRes.rows.length === 0) throw new Error('Slot not found');
        if (slotRes.rows[0].org_id !== orgId) throw new Error('Slot does not belong to this organization');
        
        const result = await client.query(
            `UPDATE appointments 
             SET proposed_slot_id = $1, reschedule_status = 'pending', reschedule_reason = $2 
             WHERE id = $3 AND org_id = $4 RETURNING *`,
            [proposedSlotId, reason, appointmentId, orgId]
        );
        
        if (result.rows.length === 0) throw new Error('Appointment not found');
        
        await client.query('COMMIT');
        return result.rows[0];
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

const respondToReschedule = async (appointmentId, userId, action) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Fetch appointment (With explicit uuid casts for reliability)
        const apptRes = await client.query(
            'SELECT * FROM appointments WHERE id = $1::uuid AND user_id = $2::uuid FOR UPDATE',
            [appointmentId, userId]
        );
        if (apptRes.rows.length === 0) throw new Error('Appointment not found');
        const appt = apptRes.rows[0];
        
        if (appt.reschedule_status !== 'pending') throw new Error('No pending reschedule proposal found');
        
        if (action === 'decline') {
            await client.query(
                `UPDATE appointments 
                 SET proposed_slot_id = NULL, reschedule_status = NULL 
                 WHERE id = $1::uuid`,
                [appointmentId]
            );
            await client.query('COMMIT');
            return { ...appt, reschedule_status: 'declined' };
        }
        
        // action === 'accept'
        const newSlotId = appt.proposed_slot_id;
        
        // 2. Fetch and Lock new slot
        const slotRes = await client.query(
            'SELECT * FROM slots WHERE id = $1::uuid AND is_active = TRUE FOR UPDATE',
            [newSlotId]
        );
        const newSlot = slotRes.rows[0];
        if (!newSlot) throw new Error('Proposed slot no longer available');
        if (newSlot.booked_count >= newSlot.max_capacity) throw new Error('Proposed slot is now full');

        // 3. Update occupancy
        if (appt.slot_id) {
            await client.query(
                'UPDATE slots SET booked_count = GREATEST(booked_count - 1, 0) WHERE id = $1::uuid',
                [appt.slot_id]
            );
        }
        await client.query(
            'UPDATE slots SET booked_count = booked_count + 1 WHERE id = $1::uuid',
            [newSlotId]
        );

        // Safer date formatting (YYYY-MM-DD)
        const newPreferredDate = new Date(newSlot.start_time).toISOString().split('T')[0];

        // 4. Update Appointment with PRIORITY (Token #1 logic)
        // To ensure Token #1, we set created_at to a very early timestamp for this partition
        const updatedApptRes = await client.query(
            `UPDATE appointments 
             SET slot_id = $1::uuid, resource_id = $2::uuid, preferred_date = $3, 
                 created_at = '1970-01-01 00:00:00', -- Token #1 Override
                 is_priority = TRUE, reschedule_status = 'accepted', reschedule_count = 0,
                 proposed_slot_id = NULL
             WHERE id = $4::uuid RETURNING *`,
            [newSlotId, newSlot.resource_id, newPreferredDate, appointmentId]
        );
        
        await client.query('COMMIT');
        return { appointment: updatedApptRes.rows[0], oldSlotId: appt.slot_id };
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error in respondToReschedule:', e);
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
    rescheduleAppointment,
    proposeReschedule,
    respondToReschedule,
    pool
};
