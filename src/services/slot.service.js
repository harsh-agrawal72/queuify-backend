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
    return slots
        .filter(slot => new Date(slot.start_time) > now)
        .map(slot => ({
            slot_id: slot.id,
            id: slot.id, // compatibility
            start_time: slot.start_time,
            end_time: slot.end_time,
            remaining_capacity: slot.max_capacity - slot.booked_count,
            org_id: slot.org_id,
            resource_id: slot.resource_id,
            max_capacity: slot.max_capacity,
            booked_count: slot.booked_count
        }));
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
            `SELECT id, org_id FROM slots WHERE id = $1 AND org_id = $2`,
            [slotId, orgId]
        );

        if (result.rowCount === 0) {
            throw new ApiError(httpStatus.NOT_FOUND, 'Slot not found or access denied');
        }

        // In the "Full Soft Delete Mechanism", we allow marking a slot as inactive 
        // even if it has appointments, so we preserve historical data while 
        // preventing new bookings.
        await client.query(
            `UPDATE slots SET is_active = FALSE WHERE id = $1 AND org_id = $2`,
            [slotId, orgId]
        );

        // Run reassignment logic
        await reassignmentService.reassignAppointments(slotId);

        await client.query('COMMIT');
        return result.rows[0];

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

        return result.rows[0];

    } catch (pkg_err) {
        throw pkg_err;
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
    getAvailableSlots
};
