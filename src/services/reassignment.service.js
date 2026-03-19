const { pool } = require('../config/db');
const emailService = require('./email.service');

/**
 * Reassign appointments from a deleted/inactive slot
 * @param {string} slotId 
 */
const reassignAppointments = async (slotId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get all affected appointments
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

        console.log(`[Reassignment] Processing ${appointments.length} appointments for slot ${slotId}`);

        for (const appt of appointments) {
            let reassigned = false;

            // 2. Logic based on preference
            if (appt.pref_resource === 'ANY') {
                // Try to find alternative slot for same service, same organization, same day
                const altSlotQuery = await client.query(
                    `SELECT s.*, r.name as resource_name 
                     FROM slots s
                     JOIN resources r ON s.resource_id = r.id
                     WHERE s.service_id = $1 
                       AND s.org_id = $2
                       AND s.is_active = TRUE
                       AND DATE(s.start_time) = DATE((SELECT start_time FROM slots WHERE id = $3))
                       AND s.id != $3
                       AND s.booked_count < s.max_capacity
                     ORDER BY (s.booked_count::float / s.max_capacity::float) ASC, 
                              ABS(EXTRACT(EPOCH FROM (s.start_time - (SELECT start_time FROM slots WHERE id = $3)))) ASC
                     LIMIT 1 FOR UPDATE`,
                    [appt.service_id, appt.org_id, slotId]
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
                    console.log(`[Reassignment] Appt ${appt.id} reassigned to slot ${altSlot.id}`);
                    
                    // Notify user
                    try {
                        await emailService.sendReassignmentEmail(appt.user_email, appt, altSlot);
                    } catch (emailErr) {
                        console.error(`[Reassignment] Email failed for ${appt.user_email}:`, emailErr.message);
                    }
                }
            }

            if (!reassigned) {
                // 3. Fallback: Waitlist or Reschedule
                if (appt.pref_time === 'URGENT') {
                    await client.query(
                        `UPDATE appointments SET status = 'waitlisted_urgent', slot_id = NULL WHERE id = $1`,
                        [appt.id]
                    );
                    console.log(`[Reassignment] Appt ${appt.id} marked as WAITLISTED_URGENT`);
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
                }
            }
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Reassignment] Error:', error.message);
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

        // 1. Get all active slots for this resource on this date
        const slotsRes = await client.query(
            `SELECT * FROM slots 
             WHERE resource_id = $1 
               AND DATE(start_time) = $2
               AND is_active = TRUE
             ORDER BY start_time ASC FOR UPDATE`,
            [resourceId, date]
        );
        const slots = slotsRes.rows;

        if (slots.length < 2) {
            console.log('[Rebalance] Not enough slots to rebalance.');
            await client.query('ROLLBACK');
            return { message: 'Not enough slots to rebalance' };
        }

        // 2. Get all confirmed appointments for these slots
        const slotIds = slots.map(s => s.id);
        const apptsRes = await client.query(
            `SELECT a.*, u.email as user_email, u.name as user_name,
                    o.name as org_name, s.name as service_name
             FROM appointments a
             JOIN users u ON a.user_id = u.id
             JOIN services s ON a.service_id = s.id
             JOIN organizations o ON a.org_id = o.id
             WHERE a.slot_id = ANY($1) 
               AND a.status = 'confirmed'
             ORDER BY a.token_number ASC`,
            [slotIds]
        );
        const appointments = apptsRes.rows;

        if (appointments.length === 0) {
            await client.query('COMMIT');
            return { message: 'No appointments to rebalance' };
        }

        console.log(`[Rebalance] Redistributing ${appointments.length} appointments across ${slots.length} slots`);

        // 3. Fair Redistribution Logic
        // Calculate target appointments per slot
        const totalAppts = appointments.length;
        const totalCapacity = slots.reduce((acc, s) => acc + s.max_capacity, 0);
        
        if (totalAppts > totalCapacity) {
            console.log('[Rebalance] Warning: Total appointments exceed total capacity. Some will remain overloaded.');
        }

        // Reset all slots booked_count temporarily in memory for distribution
        const slotDistribution = slots.map(s => ({ ...s, currentBooked: 0 }));
        
        // Distribute appointments one by one to the least filled slot (preserving capacity constraints)
        const updates = [];
        let appointmentIdx = 0;

        for (const appt of appointments) {
            // Find slot with lowest occupancy percentage that still has capacity
            // Prefer slots that are earlier if occupancy is tied
            let bestSlot = null;
            let minOccupancy = Infinity;

            for (const s of slotDistribution) {
                if (s.currentBooked < s.max_capacity) {
                    const occupancy = s.currentBooked / s.max_capacity;
                    if (occupancy < minOccupancy) {
                        minOccupancy = occupancy;
                        bestSlot = s;
                    }
                }
            }

            // Fallback: if all are over capacity, pick the one with lowest count
            if (!bestSlot) {
                bestSlot = slotDistribution.reduce((prev, curr) => (prev.currentBooked < curr.currentBooked ? prev : curr));
            }

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
        }

        // 5. Update slot booked counts in DB
        for (const s of slotDistribution) {
            await client.query(
                `UPDATE slots SET booked_count = $1 WHERE id = $2`,
                [s.currentBooked, s.id]
            );
        }

        await client.query('COMMIT');
        return { 
            message: 'Load balancing completed successfully',
            totalProcessed: appointments.length,
            movedCount: updates.length
        };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Rebalance] Error:', error.message);
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    reassignAppointments,
    rebalanceResourceSlots
};
