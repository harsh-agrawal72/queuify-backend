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

        // 2. Get all affected appointments
        const apptsQuery = await client.query(
            `SELECT a.*, u.email as user_email, u.name as user_name,
                    s.name as service_name, o.name as org_name
             FROM appointments a
             JOIN users u ON a.user_id = u.id
             JOIN services s ON a.service_id = s.id
             JOIN organizations o ON a.org_id = o.id
             WHERE a.slot_id = $1 AND a.status IN ('pending', 'confirmed')`,
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

            // 3. Construct the alternative slot query based on preferences
            // Join with resource_services because slots table doesn't have service_id
            let searchFilter = `EXISTS (SELECT 1 FROM resource_services rs WHERE rs.resource_id = s.resource_id AND rs.service_id = $1) 
                                AND s.org_id = $2 AND s.is_active = TRUE AND s.id != $3 AND s.booked_count < s.max_capacity`;
            const params = [appt.service_id, appt.org_id, slotId];

            if (isSpecific) {
                searchFilter += ` AND s.resource_id = $${params.length + 1}`;
                params.push(origSlot.resource_id);
            }

            if (isUrgent) {
                searchFilter += ` AND DATE(s.start_time) = DATE($${params.length + 1})`;
                params.push(origSlot.start_time);
            } else {
                // For flexible, we prefer same day but allow FUTURE days
                searchFilter += ` AND DATE(s.start_time) >= DATE($${params.length + 1})`;
                params.push(origSlot.start_time);
            }

            const altSlotQuery = await client.query(
                `SELECT s.*, r.name as resource_name 
                 FROM slots s
                 JOIN resources r ON s.resource_id = r.id
                 WHERE ${searchFilter}
                 ORDER BY (DATE(s.start_time) = DATE($${params.length})) DESC, 
                          (s.booked_count::float / s.max_capacity::float) ASC, 
                          ABS(EXTRACT(EPOCH FROM (s.start_time - $${params.length}))) ASC
                 LIMIT 1 FOR UPDATE`,
                params
            );

            if (altSlotQuery.rows.length > 0) {
                const altSlot = altSlotQuery.rows[0];
                
                // Update appointment
                await client.query(
                    `UPDATE appointments SET slot_id = $1, resource_id = $2, status = 'confirmed' 
                     WHERE id = $3`,
                    [altSlot.id, altSlot.resource_id, appt.id]
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
        throw error;
    } finally {
        client.release();
    }
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
        console.log(`[Waitlist-Fill] Slot ${slotId} has ${remainingCapacity} spots left. Checking waitlist...`);

        while (filledCount < remainingCapacity) {
            const eligibleQuery = await client.query(
                `SELECT a.*, u.email as user_email, u.name as user_name,
                        s.name as service_name, o.name as org_name
                 FROM appointments a
                 JOIN users u ON a.user_id = u.id
                 JOIN services s ON a.service_id = s.id
                 JOIN organizations o ON a.org_id = o.id
                 WHERE a.status IN ('waitlisted_urgent', 'waitlisted', 'pending')
                   AND a.org_id = $1
                   AND a.service_id IN (SELECT service_id FROM resource_services WHERE resource_id = $2)
                   AND (
                        a.pref_resource = 'ANY' 
                        OR (a.pref_resource = 'SPECIFIC' AND a.resource_id = $2)
                   )
                   AND (
                       -- For urgent, we must match the date exactly.
                       -- Using string comparison is more robust against timezone shifts than DATE(timestamp)
                       (a.status = 'waitlisted_urgent' AND a.preferred_date = $3) 
                       -- For pending/waitlisted, we pick them up for any future or same-day slot
                       OR (a.status IN ('waitlisted', 'pending') AND a.preferred_date <= $3)
                   )
                 ORDER BY (a.status = 'waitlisted_urgent') DESC, (a.status = 'waitlisted') DESC, a.created_at ASC
                 LIMIT 1 FOR UPDATE SKIP LOCKED`,
                [slot.org_id, slot.resource_id, new Date(slot.start_time).toISOString().split('T')[0]]
            );

            if (eligibleQuery.rows.length === 0) {
                console.log(`[Waitlist-Fill] No more eligible appointments found for slot ${slotId}`);
                break;
            }

            const appt = eligibleQuery.rows[0];
            
            // 3. Promote!
            await client.query(
                `UPDATE appointments SET status = 'confirmed', slot_id = $1, resource_id = $2 
                 WHERE id = $3`,
                [slot.id, slot.resource_id, appt.id]
            );

            await client.query(
                `UPDATE slots SET booked_count = booked_count + 1 WHERE id = $1`,
                [slot.id]
            );

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

            filledCount++;
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Waitlist-Fill] Error:', error.message);
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

        // 1. Get all active slots for this resource on this date
        const slotsRes = await client.query(
            `SELECT id, start_time, max_capacity, booked_count 
             FROM slots 
             WHERE resource_id = $1 
               AND DATE(start_time) = $2
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

        // 2. Get all eligible appointments
        // We include those already in these slots AND those for this resource on this date with NO slot
        const slotIds = slots.map(s => s.id);
        const apptsRes = await client.query(
            `SELECT a.id, a.slot_id, a.user_id, u.email as user_email, u.name as user_name,
                    o.name as org_name, s.name as service_name
             FROM appointments a
             JOIN users u ON a.user_id = u.id
             JOIN services s ON a.service_id = s.id
             JOIN organizations o ON a.org_id = o.id
             WHERE a.resource_id = $1
               AND a.status IN ('confirmed', 'pending')
               AND (
                   a.slot_id = ANY($2)
                   OR (a.slot_id IS NULL AND a.preferred_date = $3)
               )
             ORDER BY a.created_at ASC`,
            [resourceId, slotIds, date]
        );
        const appointments = apptsRes.rows;

        console.log(`[Rebalance] Found ${appointments.length} eligible appointments`);

        if (appointments.length === 0) {
            console.log('[Rebalance] Early exit: No appointments to rebalance.');
            await client.query('COMMIT');
            return { message: 'No appointments to rebalance', movedCount: 0 };
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

            if (appt.slot_id !== bestSlot.id) {
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
            // Update appointment
            await client.query(
                `UPDATE appointments SET slot_id = $1 WHERE id = $2`,
                [update.newSlotId, update.apptId]
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
