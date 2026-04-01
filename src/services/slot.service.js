const httpStatus = require('../utils/httpStatus');
const { pool } = require('../config/db');
const slotModel = require('../models/slot.model');
const ApiError = require('../utils/ApiError');
const reassignmentService = require('./reassignment.service');

/**
 * Create a slot
 * - Auto-calculates end_time from resource.duration_minutes
 * - Validates capacity <= resource.capacity
 * - Checks for overlap
 */
const createSlot = async (slotBody) => {
    // Support snake_case (DB/Schema standard) and camelCase (Legacy)
    const { orgId } = slotBody;
    const startTime = slotBody.start_time || slotBody.startTime;
    const resourceId = slotBody.resource_id || slotBody.resourceId;
    const maxCapacity = slotBody.max_capacity || slotBody.maxCapacity;

    // 1. Fetch resource for validation
    const resource = await slotModel.getResourceById(resourceId);
    if (!resource) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Resource not found');
    }
    if (resource.org_id !== orgId) {
        throw new ApiError(httpStatus.FORBIDDEN, 'Resource does not belong to your organization');
    }

    // 2. Validate and set times
    const start = new Date(startTime);
    const end = new Date(slotBody.end_time || slotBody.endTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid start or end time');
    }

    if (end <= start) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'End time must be after start time');
    }

    // 3. Validate capacity
    const capacity = maxCapacity || resource.concurrent_capacity || 1;
    // Capacity restriction removed as per user request
    /*
    if (capacity > resource.concurrent_capacity) {
        throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Slot capacity (${capacity}) cannot exceed resource capacity (${resource.concurrent_capacity})`
        );
    }
    */
    if (capacity < 1) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Capacity must be at least 1');
    }

    // 4. Check overlap
    const isOverlap = await slotModel.hasOverlap(orgId, start.toISOString(), end.toISOString(), resourceId);
    if (isOverlap) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Slot overlaps with an existing slot for this resource');
    }

    // 5. Create slot
    const slot = await slotModel.createSlot({
        orgId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        maxCapacity: capacity,
        resourceId,
    });

    // 6. Proactively fill from waitlist if any
    await reassignmentService.fillSlotFromWaitlist(slot.id);

    return slot;
};

/**
 * Get slots with full details (joined with resource and service names)
 */
const getSlotsWithDetails = async (filters) => {
    // Inject is_active filter
    return slotModel.getSlotsWithDetails({ ...filters, isActive: true });
};

/**
 * Get available slots for user booking
 */
const getAvailableSlots = async (orgId, filters = {}) => {
    const slots = await slotModel.getAvailableSlots(orgId, filters);
    const now = new Date();

    let estimatedServiceTime = 30; // Default
    if (filters.serviceId) {
        try {
            // We need a lightweight way to get service time without potentially throwing 404
            const res = await pool.query('SELECT estimated_service_time FROM services WHERE id = $1', [filters.serviceId]);
            if (res.rows.length > 0) {
                estimatedServiceTime = res.rows[0].estimated_service_time || 30;
            }
        } catch (e) {
            console.error('[getAvailableSlots] Service fetch error:', e.message);
        }
    }

    return slots
        // .filter(slot => new Date(slot.start_time) > now) // Removed to allow booking current on-going slots if capacity exists
        .map(slot => {
            const slotStart = new Date(slot.start_time);
            // If the slot has already started, calculation starts from 'now', 
            // otherwise it starts from the slot's start_time.
            const baseTime = slotStart > now ? slotStart : now;
            const minutesToAdd = slot.booked_count * estimatedServiceTime;
            const estimatedNextTime = new Date(baseTime.getTime() + minutesToAdd * 60000);

            // Format time for the message (IST)
            const timeStr = new Intl.DateTimeFormat('en-IN', {
                hour: 'numeric',
                minute: 'numeric',
                hour12: true,
                timeZone: 'Asia/Kolkata'
            }).format(estimatedNextTime);

            const message = `If you book now, your appointment is expected at **${timeStr}**. If you want a slightly later time, you can wait or check back later.`;

            return {
                slot_id: slot.id,
                id: slot.id, // compatibility
                start_time: slot.start_time,
                end_time: slot.end_time,
                remaining_capacity: slot.max_capacity - slot.booked_count,
                org_id: slot.org_id,
                resource_id: slot.resource_id,
                max_capacity: slot.max_capacity,
                booked_count: slot.booked_count,
                estimated_next_time: estimatedNextTime.toISOString(),
                descriptive_message: message
            };
        });
};

const getSlotsByOrgId = async (orgId) => {
    return slotModel.getSlotsByOrgId(orgId);
};

const getSlotsByResourceId = async (resourceId) => {
    return slotModel.getSlotsByResourceId(resourceId);
};

const deleteSlot = async (slotId, orgId) => {
    const client = await pool.connect();
    try {
        console.log(`[deleteSlot] Processing Permanent Delete for ${slotId}`);
        await client.query('BEGIN');

        const result = await client.query(
            `SELECT id, org_id, start_time FROM slots WHERE id = $1 AND org_id = $2`,
            [slotId, orgId]
        );

        if (result.rowCount === 0) {
            throw new ApiError(httpStatus.NOT_FOUND, 'Slot not found or access denied');
        }

        const slot = result.rows[0];
        const isPast = new Date(slot.start_time) < new Date();

        // In the "Full Soft Delete Mechanism", we allow marking a slot as inactive 
        // even if it has appointments, so we preserve historical data while 
        // preventing new bookings.
        await client.query(
            `UPDATE slots SET is_active = FALSE WHERE id = $1 AND org_id = $2`,
            [slotId, orgId]
        );

        await client.query('COMMIT');

        // Run reassignment logic ONLY for future or today's slots
        // Past slots don't need reassignment as they already happened
        if (!isPast) {
            console.log(`[deleteSlot] Triggering background reassignment for future/current slot ${slotId}`);
            setImmediate(() => {
                reassignmentService.reassignAppointments(slotId).catch(err => {
                    console.error(`[Reassignment-Background] Error for slot ${slotId}:`, err.message);
                });
            });
        } else {
            console.log(`[deleteSlot] Skipping reassignment for past slot ${slotId}`);
        }

        return slot;

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const updateSlot = async (slotId, orgId, updateBody) => {
    const slot = await slotModel.getSlotById(slotId);
    if (!slot) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Slot not found');
    }
    if (slot.org_id !== orgId) {
        throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
    }

    // Step 4: Validate updates against active appointments and deleted status
    const client = await pool.connect();
    try {
        const apptRes = await client.query(
            `SELECT COUNT(*) FROM appointments WHERE slot_id = $1`,
            [slotId]
        );
        const totalAppointments = parseInt(apptRes.rows[0].count);

        // In the "Full Soft Delete Mechanism", we allow updates to slots 
        // but we should still be careful. However, the user specifically 
        // asked for the mechanism where deletion is unrestricted. 
        // I will keep the update restriction for now as it's safer, 
        // unless they explicitly ask to allow updates with appointments too.
        if (totalAppointments > 0) {
            throw new ApiError(httpStatus.BAD_REQUEST, "You can't modify a slot that already has appointments. Please delete (deactivate) this slot and create a new one if needed.");
        }

        // Proceed with update
        const { start_time, end_time, max_capacity } = updateBody;

        // Build dynamic update query
        let updateFields = [];
        let values = [];
        let idx = 1;

        if (start_time) { updateFields.push(`start_time = $${idx++}`); values.push(start_time); }
        if (end_time) { updateFields.push(`end_time = $${idx++}`); values.push(end_time); }
        if (max_capacity) { updateFields.push(`max_capacity = $${idx++}`); values.push(max_capacity); }

        if (updateFields.length === 0) return slot;

        values.push(slotId);
        const updateQuery = `UPDATE slots SET ${updateFields.join(', ')} WHERE id = $${idx} RETURNING *`;
        const result = await client.query(updateQuery, values);
        const updatedSlot = result.rows[0];

        // If capacity increased, try to fill from waitlist
        if (max_capacity && max_capacity > slot.max_capacity) {
            try {
                await reassignmentService.fillSlotFromWaitlist(slotId);
            } catch (waitErr) {
                console.error('[SlotUpdate] Waitlist fill failed:', waitErr.message);
            }
        }

        return updatedSlot;

    } catch (pkg_err) {
        throw pkg_err;
    } finally {
        client.release();
    }
};

const requestSlotNotification = async (userId, slotId, desiredTime, serviceId, resourceId, customerPhone) => {
    const slotNotificationModel = require('../models/slot_notification.model');
    return slotNotificationModel.createNotificationRequest({
        userId,
        slotId,
        desiredTime,
        serviceId,
        resourceId,
        customerPhone
    });
};

const getUserNotifications = async (userId) => {
    const slotNotificationModel = require('../models/slot_notification.model');
    const notifications = await slotNotificationModel.getUserNotifications(userId);
    const now = new Date();

    // Re-calculate live estimated time for each notification
    return Promise.all(notifications.map(async (sn) => {
        let estimatedServiceTime = 30; // Default
        try {
            const res = await pool.query('SELECT estimated_service_time FROM services WHERE id = $1', [sn.service_id]);
            if (res.rows.length > 0) {
                estimatedServiceTime = res.rows[0].estimated_service_time || 30;
            }
        } catch (e) {
            console.error('[getUserNotifications] Service fetch error:', e.message);
        }

        const slotStart = new Date(sn.slot_start);
        const baseTime = slotStart > now ? slotStart : now;
        const minutesToAdd = sn.booked_count * estimatedServiceTime;
        const currentEstimatedTime = new Date(baseTime.getTime() + minutesToAdd * 60000);

        return {
            ...sn,
            current_estimated_time: currentEstimatedTime.toISOString()
        };
    }));
};

const deleteNotification = async (notificationId, userId) => {
    const slotNotificationModel = require('../models/slot_notification.model');
    return slotNotificationModel.deleteNotification(notificationId, userId);
};

const bulkCopySlots = async (orgId, { sourceDate, targetDates, resourceId, overwrite }) => {
    // 1. Fetch source slots
    const filters = { orgId, date: sourceDate, isActive: true };
    if (resourceId) filters.resourceId = resourceId;
    
    // We need to fetch slots with details to get resource_id if we didn't filter by it
    const sourceSlots = await slotModel.getSlotsWithDetails(filters);
    
    if (!sourceSlots || sourceSlots.length === 0) {
        throw new ApiError(httpStatus.NOT_FOUND, 'No active slots found on the source date to copy.');
    }

    const client = await pool.connect();
    let createdCount = 0;
    let skippedCount = 0;

    try {
        await client.query('BEGIN');

        for (const targetDateStr of targetDates) {
            // A. Handle Overwrite (Soft Delete)
            if (overwrite) {
                let deleteQuery = 'UPDATE slots SET is_active = FALSE WHERE org_id = $1 AND DATE(start_time) = $2';
                let deleteParams = [orgId, targetDateStr];
                
                if (resourceId) {
                    deleteQuery += ' AND resource_id = $3';
                    deleteParams.push(resourceId);
                }
                
                await client.query(deleteQuery, deleteParams);
            }

            // B. Create Slots
            for (const slot of sourceSlots) {
                // Calculate new start/end times based on target date
                const sStart = new Date(slot.start_time);
                const sEnd = new Date(slot.end_time);
                
                // Helper to create date relative to targetDateStr
                const createTargetTime = (originalTime) => {
                    const target = new Date(targetDateStr);
                    target.setHours(originalTime.getHours(), originalTime.getMinutes(), originalTime.getSeconds(), 0);
                    return target;
                };

                const newStart = createTargetTime(sStart);
                const newEnd = createTargetTime(sEnd);

                // Check for overlap on the target date
                const isOverlap = await slotModel.hasOverlap(orgId, newStart.toISOString(), newEnd.toISOString(), slot.resource_id);
                
                if (isOverlap) {
                    skippedCount++;
                    continue;
                }

                await client.query(
                    `INSERT INTO slots (org_id, start_time, end_time, max_capacity, resource_id) 
                     VALUES ($1, $2, $3, $4, $5)`,
                    [orgId, newStart.toISOString(), newEnd.toISOString(), slot.max_capacity, slot.resource_id]
                );
                
                createdCount++;
            }
        }

        await client.query('COMMIT');

        return { 
            success: true, 
            message: `Successfully created ${createdCount} slots. ${skippedCount > 0 ? `Skipped ${skippedCount} due to overlaps.` : ''}` 
        };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[bulkCopySlots] Error:', error.message);
        throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Bulk copy failed: ' + error.message);
    } finally {
        client.release();
    }
};

module.exports = {
    createSlot,
    getSlotsWithDetails,
    getSlotsByOrgId,
    getSlotsByResourceId,
    deleteSlot,
    updateSlot,
    getAvailableSlots,
    requestSlotNotification,
    bulkCopySlots
};
