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
                    s.name as service_name, o.name as org_name
             FROM appointments a
             JOIN users u ON a.user_id = u.id
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
                    TO_CHAR(s.start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') = $${dateParamIdx}
                )`; 
            } else {
                // For flexible, we prefer same day but allow FUTURE days
                searchFilter += ` AND (
                    TO_CHAR(s.start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') >= $${dateParamIdx}
                )`;
            }

            const altSlotQuery = await client.query(
                `SELECT s.*, r.name as resource_name 
                 FROM slots s
                 JOIN resources r ON s.resource_id = r.id
                 WHERE ${searchFilter}
                 ORDER BY 
                    (TO_CHAR(s.start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') = $${dateParamIdx}) DESC, 
                    (s.start_time > $${startTimeParamIdx}::timestamp) DESC, -- Prefer "next" slots
                    (s.booked_count::float / NULLIF(s.max_capacity, 0)::float) ASC, 
                    ABS(EXTRACT(EPOCH FROM (s.start_time - $${startTimeParamIdx}::timestamp))) ASC
                 LIMIT 1 FOR UPDATE`,
                params
            );

            if (altSlotQuery.rows.length > 0) {
                const altSlot = altSlotQuery.rows[0];
                
                // Update appointment with new slot and sync date
                const newDate = getLocalDateString(altSlot.start_time);
                await client.query(
                    `UPDATE appointments 
                     SET slot_id = $1, resource_id = $2, preferred_date = $3, 
                         created_at = NOW(), status = 'confirmed' 
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
                try {
                    await emailService.sendReassignmentEmail(appt.user_email, appt, altSlot);
                } catch (emailErr) {
                    console.error(`[Reassignment] Email failed for ${appt.user_email}:`, emailErr.message);
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
                    try {
                        await emailService.sendWaitlistEmail(appt.user_email, appt);
                    } catch (emailErr) {
                        console.error(`[Reassignment] Email failed for ${appt.user_email}:`, emailErr.message);
                    }
                } else {
                    // Standard reschedule/pending
                    await client.query(
                        `UPDATE appointments SET status = 'pending', slot_id = NULL WHERE id = $1`,
                        [appt.id]
                    );
                    console.log(`[Reassignment] Appt ${appt.id} marked as PENDING (Needs Rescheduling)`);
                    try {
                        await emailService.sendRescheduleEmail(appt.user_email, appt);
                    } catch (emailErr) {
                        console.error(`[Reassignment] Email failed for ${appt.user_email}:`, emailErr.message);
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
        
        console.log(`[Waitlist-Fill] Slot ${slotId} (${slot.resource_name}) at ${slot.start_time} (Local Date: ${localDate}) has ${remainingCapacity} spots left.`);

        while (filledCount < remainingCapacity) {
            const eligibleQuery = await client.query(
                `SELECT a.*, u.email as user_email, u.name as user_name,
                        s.name as service_name, o.name as org_name
                 FROM appointments a
                 JOIN users u ON a.user_id = u.id
                 JOIN services s ON a.service_id = s.id
                 JOIN organizations o ON a.org_id = o.id
                 WHERE a.status IN ('waitlisted_urgent', 'waitlisted_regular', 'pending')
                   AND a.org_id = $1
                   AND (
                        a.service_id IN (SELECT service_id FROM resource_services WHERE resource_id = $2)
                        OR a.service_id = (SELECT service_id FROM resources WHERE id = $2)
                   )
                   AND (
                        a.pref_resource = 'ANY' 
                        OR (a.pref_resource = 'SPECIFIC' AND a.resource_id = $2)
                   )
                   AND (
                       -- For urgent, we must match the date exactly.
                       (a.status = 'waitlisted_urgent' AND a.preferred_date = $3) 
                       -- For pending/waitlisted, we pick them up for any future or same-day slot
                       OR (a.status IN ('waitlisted_regular', 'pending') AND a.preferred_date <= $3)
                   )
                 ORDER BY (a.status = 'waitlisted_urgent') DESC, (a.status = 'waitlisted_regular') DESC, a.created_at ASC
                 LIMIT 1 FOR UPDATE SKIP LOCKED`,
                [slot.org_id, slot.resource_id, localDate]
            );

            if (eligibleQuery.rows.length === 0) {
                console.log(`[Waitlist-Fill] No more eligible appointments found for slot ${slotId} (Date: ${localDate})`);
                break;
            }

            const appt = eligibleQuery.rows[0];
            
            // 3. Promote!
            // Sync date to the new slot's date
            await client.query(
                `UPDATE appointments SET status = 'confirmed', slot_id = $1, resource_id = $2, preferred_date = $3, created_at = NOW()
                 WHERE id = $4`,
                [slot.id, slot.resource_id, localDate, appt.id]
            );

            await client.query(
                `UPDATE slots SET booked_count = booked_count + 1 WHERE id = $1`,
                [slot.id]
            );

            filledCount++;
            console.log(`[Waitlist-Fill] Appt ${appt.id} promoted from ${appt.status} to confirmed for slot ${slotId}`);
            
            // 4. Notify
            try {
                await emailService.sendReassignmentEmail(appt.user_email, appt, slot);
            } catch (err) {
                console.error(`[Waitlist-Fill] Email failed for ${appt.user_email}:`, err.message);
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
        await client.query('ROLLBACK');
        console.error('[Waitlist-Fill] Error:', error.message);
        console.dir(error, { depth: null });
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
               AND TO_CHAR(start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') = $2
               AND is_active = TRUE
             ORDER BY start_time ASC FOR UPDATE`,
            [resourceId, date]
        );
        const slots = slotsRes.rows;

        console.log(`[Rebalance] Found ${slots.length} active slots`);

        if (slots.length < 2) {
            console.log('[Rebalance] Early exit: Not enough slots to rebalance (< 2).');
            await client.query('ROLLBACK');
            return { message: 'Not enough slots to rebalance', movedCount: 0 };
        }

        // 2. Get all eligible appointments for this resource on this date
        // We include confirmed and pending appointments that are currently assigned to ANY slot on this date
        // for this resource. We join with slots to be robust about the date.
        const apptsRes = await client.query(
            `SELECT a.id, a.slot_id, a.user_id, u.email as user_email, u.name as user_name,
                    o.name as org_name, s.name as service_name, a.preferred_date
             FROM appointments a
             JOIN users u ON a.user_id = u.id
             JOIN services s ON a.service_id = s.id
             JOIN organizations o ON a.org_id = o.id
             LEFT JOIN slots sl ON a.slot_id = sl.id
             WHERE a.resource_id = $1
               AND a.status IN ('confirmed', 'pending')
               AND (
                   (a.slot_id IS NOT NULL AND TO_CHAR(sl.start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') = $2)
                   OR (a.slot_id IS NULL AND a.preferred_date = $2::date)
               )
             ORDER BY a.created_at ASC`,
            [resourceId, date]
        );
        const appointments = apptsRes.rows;

        console.log(`[Rebalance] Found ${appointments.length} eligible appointments for resource ${resourceId} on date ${date}`);
        
        if (appointments.length === 0) {
            console.log('[Rebalance] Early exit: No appointments found for this resource/date.');
            await client.query('COMMIT');
            return { message: 'No appointments to rebalance', movedCount: 0, totalProcessed: 0 };
        }
        // 3. Fair Redistribution Logic
        // Reset all slots booked_count temporarily in memory for distribution
        const slotDistribution = slots.map(s => ({ 
            id: s.id, 
            max_capacity: parseInt(s.max_capacity) || 1, 
            currentBooked: 0,
            originalSlot: s
        }));
        
        const updates = [];

        for (const appt of appointments) {
            // Find slot with lowest occupancy percentage
            // Prefer slots that are earlier if occupancy is tied (already sorted by start_time)
            let bestSlot = null;
            let minOccupancy = Infinity;

            for (const s of slotDistribution) {
                const occupancy = s.currentBooked / s.max_capacity;
                if (occupancy < minOccupancy) {
                    minOccupancy = occupancy;
                    bestSlot = s;
                }
            }

            // Fallback (redundant with current loop but safe)
            if (!bestSlot) bestSlot = slotDistribution[0];

            if (String(appt.slot_id) !== String(bestSlot.id)) {
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

        console.log(`[Rebalance] Identified ${updates.length} necessary moves out of ${appointments.length} appointments`);

        // 4. Apply updates and Notify
        for (const update of updates) {
            // Update appointment and sync date
            const newDate = getLocalDateString(update.newSlot.originalSlot.start_time);
            await client.query(
                `UPDATE appointments SET slot_id = $1, preferred_date = $2, created_at = NOW() WHERE id = $3`,
                [update.newSlotId, newDate, update.apptId]
            );
            
            // Notify user
            try {
                await emailService.sendRebalanceNotificationEmail(update.appt.user_email, update.appt, update.newSlot);
            } catch (err) {
                console.error(`[Rebalance] Email failed for ${update.appt.user_email}:`, err.message);
            }

            // Emit Socket Update
            try {
                socket.getIO().to(`user_${update.appt.user_id}`).emit('appointment_updated', {
                    appointmentId: update.apptId,
                    type: 'rebalance',
                    status: 'confirmed'
                });
            } catch (sErr) { console.error('[Socket] failed:', sErr.message); }
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
    fillSlotFromWaitlist
};
