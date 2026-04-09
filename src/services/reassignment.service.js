const { pool } = require('../config/db');
const emailService = require('./email.service');
const socket = require('../socket/index');

/**
 * Reassign appointments from a deleted/inactive slot
 * @param {string} slotId 
 */
const reassignAppointments = async (slotId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get original slot info for context
        const origSlotRes = await client.query('SELECT start_time, resource_id, org_id FROM slots WHERE id = $1', [slotId]);
        if (origSlotRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return;
        }
        const origSlot = origSlotRes.rows[0];
        console.log(`[Reassignment] Original Slot: ${origSlot.start_time}, Resource: ${origSlot.resource_id}`);

        // 2. Get all affected appointments, prioritizing URGENT ones
        const apptsQuery = await client.query(
            `SELECT a.*, u.email as user_email, u.name as user_name,
                    u.email_notification_enabled, u.notification_enabled,
                    s.name as service_name, o.name as org_name, o.email_notification as org_email_enabled
             FROM appointments a
             LEFT JOIN users u ON a.user_id = u.id
             JOIN services s ON a.service_id = s.id
             JOIN organizations o ON a.org_id = o.id
             WHERE a.slot_id = $1 AND a.status IN ('pending', 'confirmed')
             ORDER BY (a.pref_time = 'URGENT') DESC, a.created_at ASC`,
            [slotId]
        );
        const appointments = apptsQuery.rows;

        if (appointments.length === 0) {
            await client.query('COMMIT');
            return;
        }

        console.log(`[Reassignment] Processing ${appointments.length} appointments for defunct slot ${slotId}`);

        for (const appt of appointments) {
            let reassigned = false;
            const isUrgent = appt.pref_time === 'URGENT';
            const isSpecific = appt.pref_resource === 'SPECIFIC';

            // Consistent timezone-safe date string (YYYY-MM-DD in India time)
            const localDateStr = getLocalDateString(origSlot.start_time);
            const origStartTime = new Date(origSlot.start_time).toISOString();

            const params = [appt.service_id, appt.org_id, slotId];
            let searchFilter = `EXISTS (SELECT 1 FROM resource_services rs WHERE rs.resource_id = s.resource_id AND rs.service_id = $1) 
                                AND s.org_id = $2 AND s.is_active = TRUE AND s.id != $3 AND s.booked_count < s.max_capacity`;

            if (isSpecific) {
                params.push(origSlot.resource_id);
                searchFilter += ` AND s.resource_id = $${params.length}`;
            }

            params.push(localDateStr);
            const dateParamIdx = params.length;

            params.push(origStartTime);
            const startTimeParamIdx = params.length;

            if (isUrgent) {
                // Must be the same local date
                searchFilter += ` AND (
                    TO_CHAR(s.start_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') = $${dateParamIdx}
                )`; 
            } else {
                // For flexible, we prefer same day but allow FUTURE days
                searchFilter += ` AND (
                    TO_CHAR(s.start_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') >= $${dateParamIdx}
                )`;
            }

            const altSlotQuery = await client.query(
                `SELECT s.*, r.name as resource_name 
                 FROM slots s
                 JOIN resources r ON s.resource_id = r.id
                 WHERE ${searchFilter}
                 ORDER BY 
                    (TO_CHAR(s.start_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') = $${dateParamIdx}) DESC, 
                    (s.start_time > $${startTimeParamIdx}::timestamp) DESC, -- Prefer "next" slots
                    (s.booked_count::float / NULLIF(s.max_capacity, 0)::float) ASC, 
                    ABS(EXTRACT(EPOCH FROM (s.start_time - $${startTimeParamIdx}::timestamp))) ASC
                 LIMIT 1 FOR UPDATE OF s`,
                params
            );

            if (altSlotQuery.rows.length > 0) {
                const altSlot = altSlotQuery.rows[0];
                
                // Update appointment with new slot and sync date
                const newDate = getLocalDateString(altSlot.start_time);
                await client.query(
                    `UPDATE appointments 
                     SET slot_id = $1, resource_id = $2, preferred_date = $3, 
                         status = 'confirmed' 
                     WHERE id = $4`,
                    [altSlot.id, altSlot.resource_id, newDate, appt.id]
                );

                // Update slot booked count
                await client.query(
                    `UPDATE slots SET booked_count = booked_count + 1 WHERE id = $1`,
                    [altSlot.id]
                );

                reassigned = true;
                console.log(`[Reassignment] Appt ${appt.id} reassigned to slot ${altSlot.id} (${altSlot.resource_name})`);
            
                // Emit Socket Update
                try {
                    socket.getIO().to(`user_${appt.user_id}`).emit('appointment_updated', {
                        appointmentId: appt.id,
                        type: 'reassignment',
                        status: 'confirmed'
                    });
                } catch (sErr) { console.error('[Socket] failed:', sErr.message); }
                
                // Notify user
                const userEmailEnabled = appt.email_notification_enabled !== false;

                if (appt.user_email && userEmailEnabled) {
                    emailService.sendReassignmentEmail(appt.user_email, appt, altSlot).catch(emailErr => {
                        console.error(`[Reassignment] Email failed for ${appt.user_email}:`, emailErr.message);
                    });
                }
            }

            if (!reassigned) {
                // 4. Fallback: Waitlist or Reschedule
                if (isUrgent) {
                    await client.query(
                        `UPDATE appointments SET status = 'waitlisted_urgent', slot_id = NULL WHERE id = $1`,
                        [appt.id]
                    );
                    console.log(`[Reassignment] Appt ${appt.id} marked as WAITLISTED_URGENT (No slots today)`);
                    const userEmailEnabled = appt.email_notification_enabled !== false;
                    if (appt.user_email && userEmailEnabled) {
                        emailService.sendWaitlistEmail(appt.user_email, appt).catch(emailErr => {
                            console.error(`[Reassignment-Waitlist] Email failed for ${appt.user_email}:`, emailErr.message);
                        });
                    }
                } else {
                    // Standard reschedule/pending
                    await client.query(
                        `UPDATE appointments SET status = 'pending', slot_id = NULL WHERE id = $1`,
                        [appt.id]
                    );
                    console.log(`[Reassignment] Appt ${appt.id} marked as PENDING (Needs Rescheduling)`);
                    const userEmailEnabled = appt.email_notification_enabled !== false;
                    if (appt.user_email && userEmailEnabled) {
                        emailService.sendRescheduleEmail(appt.user_email, appt).catch(emailErr => {
                            console.error(`[Reassignment-Reschedule] Email failed for ${appt.user_email}:`, emailErr.message);
                        });
                    }

                    // Emit Socket Update
                    try {
                        socket.getIO().to(`user_${appt.user_id}`).emit('appointment_updated', {
                            appointmentId: appt.id,
                            type: 'reassignment_failed',
                            status: 'pending'
                        });
                    } catch (sErr) { console.error('[Socket] failed:', sErr.message); }
                }
            }
        }

        await client.query('COMMIT');
        console.log(`[Reassignment] Completed for slot ${slotId}`);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Reassignment] Error:', error.message);
        console.dir(error, { depth: null });
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Helper to get YYYY-MM-DD in Asia/Kolkata timezone from a Date or timestamp
 */
const getLocalDateString = (date) => {
    if (!date) return null;
    return new Intl.DateTimeFormat('en-CA', { 
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date(date));
};

/**
 * Triggered when a slot becomes available (cancellation, reassignment)
 * Pulls someone from the waitlist into this slot if they match preferences.
 * @param {string} slotId 
 */
const fillSlotFromWaitlist = async (slotId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get slot info
        const slotRes = await client.query(
            `SELECT s.*, r.name as resource_name 
             FROM slots s 
             JOIN resources r ON s.resource_id = r.id 
             WHERE s.id = $1 AND s.is_active = TRUE FOR UPDATE`, 
            [slotId]
        );
        if (slotRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return;
        }
        const slot = slotRes.rows[0];

        if (slot.booked_count >= slot.max_capacity) {
            console.log(`[Waitlist-Fill] Slot ${slotId} is already full. Skipping.`);
            await client.query('ROLLBACK');
            return;
        }

        // 2. Loop until slot is full or no more eligible appointments
        let filledCount = 0;
        const remainingCapacity = slot.max_capacity - slot.booked_count;
        const localDate = getLocalDateString(slot.start_time);
        
        while (filledCount < remainingCapacity) {
            const eligibleQuery = await client.query(
                `SELECT a.*, u.email as user_email, u.name as user_name,
                        u.email_notification_enabled, u.notification_enabled,
                        s.name as service_name, o.name as org_name, o.email_notification as org_email_enabled
                 FROM appointments a
                 LEFT JOIN users u ON a.user_id = u.id
                 JOIN services s ON a.service_id = s.id
                 JOIN organizations o ON a.org_id = o.id
                 WHERE a.status IN ('waitlisted_urgent', 'pending', 'waitlisted')
                   AND a.org_id = $1
                   AND (
                        -- Service must be supported by the resource
                        a.service_id IN (SELECT rs.service_id FROM resource_services rs WHERE rs.resource_id = $2)
                   )
                   AND (
                        -- Resource preference matching
                        a.pref_resource = 'ANY' 
                        OR (a.pref_resource = 'SPECIFIC' AND (a.resource_id = $2 OR a.slot_id IS NULL))
                   )
                   AND (
                        -- Date must be today or in the past (already overdue)
                        a.preferred_date::date <= $3::date
                        OR (a.slot_id IS NULL AND a.status = 'pending' AND a.preferred_date::date <= $3::date)
                   )
                 ORDER BY 
                    (a.status = 'waitlisted_urgent') DESC, -- 1. Urgent status first
                    (a.preferred_date <= $3::date) DESC,   -- 2. Today or past dates first
                    a.created_at ASC                       -- 3. Oldest in those groups first
                 LIMIT 1 FOR UPDATE OF a SKIP LOCKED`,
                [slot.org_id, slot.resource_id, localDate]
            );

            if (eligibleQuery.rows.length === 0) {
                break;
            }

            const appt = eligibleQuery.rows[0];
            
            // 3. Promote!
            // Sync date to the new slot's date
            await client.query(
                `UPDATE appointments SET status = 'confirmed', slot_id = $1, resource_id = $2, preferred_date = $3, updated_at = NOW()
                 WHERE id = $4`,
                [slot.id, slot.resource_id, localDate, appt.id]
            );

            await client.query(
                `UPDATE slots SET booked_count = booked_count + 1 WHERE id = $1`,
                [slot.id]
            );

            filledCount++;
            
            // Notify user only if enabled
            const userEmailEnabled = appt.email_notification_enabled !== false;
            if (appt.user_email && userEmailEnabled) {
                emailService.sendReassignmentEmail(appt.user_email, appt, slot).catch(err => {
                    console.error(`[Waitlist-Fill] Email failed for ${appt.user_email}:`, err.message);
                });
            }

            // Emit Socket Update
            try {
                socket.getIO().to(`user_${appt.user_id}`).emit('appointment_updated', {
                    appointmentId: appt.id,
                    type: 'waitlist_promotion',
                    status: 'confirmed'
                });
            } catch (sErr) { console.error('[Socket] failed:', sErr.message); }
        }

        await client.query('COMMIT');
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('[Waitlist-Fill] Error:', error.message);
    } finally {
        client.release();
    }
};

/**
 * Emergency Mode: Bulk Reschedule
 * Deactivates slots for a resource and marks appointments for reassessment.
 */
const triggerEmergencyMode = async (orgId, resourceId, date) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log(`[Emergency] Triggered for Resource: ${resourceId}, Date: ${date}`);

        // 1. Get all active slots for this resource on this date
        const slotsRes = await client.query(
            `SELECT id FROM slots 
             WHERE resource_id = $1 AND org_id = $2
               AND TO_CHAR(start_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') = $3
               AND is_active = TRUE`,
            [resourceId, orgId, date]
        );

        if (slotsRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return { message: 'No active slots found for this resource on this date', affectedCount: 0 };
        }

        const slotIds = slotsRes.rows.map(s => s.id);

        // 2. Deactivate all those slots
        await client.query(
            `UPDATE slots SET is_active = FALSE WHERE id = ANY($1)`,
            [slotIds]
        );

        // 3. Mark all appointments as pending & slot-less
        // This makes them eligible for the relaxed 'fillSlotFromWaitlist' logic
        const apptRes = await client.query(
            `UPDATE appointments 
             SET status = 'pending', slot_id = NULL, updated_at = NOW()
             WHERE slot_id = ANY($1) AND status IN ('confirmed', 'pending')
             RETURNING id, user_id`,
            [slotIds]
        );

        await client.query('COMMIT');

        console.log(`[Emergency] Deactivated ${slotIds.length} slots. Marked ${apptRes.rows.length} appointments for reassignment.`);

        // 4. Notify affected users
        for (const appt of apptRes.rows) {
            try {
                socket.getIO().to(`user_${appt.user_id}`).emit('notification', {
                    title: 'Service Interruption',
                    message: 'Due to an emergency, your appointment has been moved to our priority waitlist. We will notify you as soon as a new slot is available.',
                    type: 'emergency'
                });
            } catch (err) { /* ignore socket errors */ }
        }

        return { 
            message: 'Emergency mode activated', 
            slotsDeactivated: slotIds.length, 
            appointmentsAffected: apptRes.rows.length 
        };

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Fairly redistribute appointments across same-day slots for a given resource
 * @param {string} resourceId 
 * @param {string} date - YYYY-MM-DD
 */
const rebalanceResourceSlots = async (resourceId, date) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log(`[Rebalance] Starting for Resource: ${resourceId}, Date: ${date}`);

        // 1. Get all active slots for this resource on this date (Local Time)
        const slotsRes = await client.query(
            `SELECT id, start_time, max_capacity, booked_count 
             FROM slots 
             WHERE resource_id = $1 
               AND TO_CHAR(start_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') = $2
               AND is_active = TRUE
             ORDER BY start_time ASC FOR UPDATE`,
            [resourceId, date]
        );
        const slots = slotsRes.rows;

        console.log(`[Rebalance] Found ${slots.length} active slots for resource ${resourceId} on ${date}:`, 
            slots.map(s => ({ id: s.id, time: s.start_time, cap: s.max_capacity, booked: s.booked_count }))
        );

        if (slots.length < 2) {
            console.log('[Rebalance] Early exit: Not enough slots to rebalance (< 2).');
            await client.query('ROLLBACK');
            return { message: 'Not enough slots to rebalance', movedCount: 0 };
        }

        // 2. Get all eligible appointments for this resource on this date
        const apptsRes = await client.query(
            `SELECT a.id, a.slot_id, a.user_id, a.status, a.created_at,
                    u.email as user_email, u.name as user_name,
                    u.email_notification_enabled, u.notification_enabled,
                    o.name as org_name, o.email_notification as org_email_enabled, 
                    s.name as service_name, a.preferred_date
             FROM appointments a
             LEFT JOIN users u ON a.user_id = u.id
             JOIN services s ON a.service_id = s.id
             JOIN organizations o ON a.org_id = o.id
             LEFT JOIN slots sl ON a.slot_id = sl.id
             WHERE (a.resource_id = $1 OR sl.resource_id = $1)
               AND a.status IN ('confirmed', 'pending', 'waitlisted_urgent')
               AND (
                   (a.slot_id IS NOT NULL AND TO_CHAR(sl.start_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') = $2)
                   OR (a.slot_id IS NULL AND a.preferred_date = $2::date)
               )
             ORDER BY a.created_at ASC`,
            [resourceId, date]
        );
        const appointments = apptsRes.rows;

        if (appointments.length === 0) {
            console.log('[Rebalance] Early exit: No appointments found for this resource/date.');
            await client.query('COMMIT');
            return { message: 'No appointments to rebalance', movedCount: 0, totalProcessed: 0 };
        }
        // 3. Fair Redistribution Logic
        const slotDistribution = slots.map(s => ({ 
            id: s.id, 
            max_capacity: parseInt(s.max_capacity) || 1, 
            currentBooked: 0,
            originalSlot: s
        }));
        
        const updates = [];

        for (const appt of appointments) {
            let bestSlot = null;
            let minOccupancy = Infinity;

            for (const s of slotDistribution) {
                const occupancy = s.currentBooked / s.max_capacity;
                if (occupancy < minOccupancy) {
                    minOccupancy = occupancy;
                    bestSlot = s;
                }
            }

            if (!bestSlot) bestSlot = slotDistribution[0];

            if (!appt.slot_id || String(appt.slot_id) !== String(bestSlot.id)) {
                updates.push({
                    apptId: appt.id,
                    oldSlotId: appt.slot_id,
                    newSlotId: bestSlot.id,
                    appt: appt,
                    newSlot: bestSlot
                });
            }

            bestSlot.currentBooked++;
        }

        // 4. Apply updates and Notify
        for (const update of updates) {
            const newDate = getLocalDateString(update.newSlot.originalSlot.start_time);
            await client.query(
                `UPDATE appointments SET slot_id = $1, resource_id = $2, preferred_date = $3, status = 'confirmed', updated_at = NOW() WHERE id = $4`,
                [update.newSlotId, resourceId, newDate, update.apptId]
            );

            const userEmailEnabled = update.appt.email_notification_enabled !== false;
            if (update.appt.user_email && userEmailEnabled) {
                emailService.sendRebalanceNotificationEmail(update.appt.user_email, update.appt, update.newSlot).catch(err => {
                    console.error(`[Rebalance] Email failed for ${update.appt.user_email}:`, err.message);
                });
            }


            // Emit Socket Update if user is logged in
            if (update.appt.user_id) {
                try {
                    socket.getIO().to(`user_${update.appt.user_id}`).emit('appointment_updated', {
                        appointmentId: update.apptId,
                        type: 'rebalance',
                        status: 'confirmed'
                    });
                } catch (sErr) { console.error('[Socket] failed:', sErr.message); }
            }
        }


        // 5. Update slot booked counts in DB
        for (const s of slotDistribution) {
            await client.query(
                `UPDATE slots SET booked_count = $1 WHERE id = $2`,
                [s.currentBooked, s.id]
            );
        }

        await client.query('COMMIT');
        console.log(`[Rebalance] Successfully completed. Moved: ${updates.length}`);

        return { 
            message: 'Load balancing completed successfully',
            totalProcessed: appointments.length,
            movedCount: updates.length
        };

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('[Rebalance-CRITICAL] Error Details:', {
            message: error.message,
            stack: error.stack,
            resourceId,
            date
        });
        throw new Error(`Rebalance Failed: ${error.message}`);
    } finally {
        if (client) client.release();
    }
};

module.exports = {
    reassignAppointments,
    rebalanceResourceSlots,
    fillSlotFromWaitlist,
    triggerEmergencyMode
};
