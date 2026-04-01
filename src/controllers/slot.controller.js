const httpStatus = require('../utils/httpStatus');
const catchAsync = require('../utils/catchAsync');
const { slotService } = require('../services');
const ApiError = require('../utils/ApiError');

const createSlot = catchAsync(async (req, res) => {
    const slotBody = { ...req.body, orgId: req.user.org_id };
    const slot = await slotService.createSlot(slotBody);
    res.status(httpStatus.CREATED).send(slot);
});

/**
 * GET /slots — returns slots with joined resource/service data
 * Supports query params: resourceId, serviceId, date
 * Always scoped to admin's org
 */
const getSlots = catchAsync(async (req, res) => {
    const orgId = req.user.org_id;
    console.log('[getSlots] orgId:', orgId, 'query:', req.query);
    if (!orgId) {
        return res.send([]);
    }
    const filters = {
        orgId,
        resourceId: req.query.resourceId || undefined,
        serviceId: req.query.serviceId || undefined,
        date: req.query.date || undefined,
    };
    try {
        const slots = await slotService.getSlotsWithDetails(filters);
        console.log('[getSlots] Returning', slots.length, 'slots');
        res.send(slots);
    } catch (err) {
        console.error('[getSlots] ERROR:', err.message, err.stack);
        throw err;
    }
});

const getAvailableSlots = catchAsync(async (req, res) => {
    const filters = {
        serviceId: req.query.serviceId || undefined,
        resourceId: req.query.resourceId || undefined,
        date: req.query.date || undefined,
    };
    console.log('[getAvailableSlots] orgId:', req.params.orgId, 'filters:', filters);
    const slots = await slotService.getAvailableSlots(req.params.orgId, filters);
    res.send(slots);
});

const deleteSlot = catchAsync(async (req, res) => {
    const orgId = req.user.org_id;
    if (!orgId) {
        throw new ApiError(httpStatus.FORBIDDEN, 'Action restricted to organization admins');
    }
    await slotService.deleteSlot(req.params.slotId, orgId);
    res.status(httpStatus.OK).json({ success: true, message: 'Slot soft deleted successfully' });
});

const requestSlotNotification = catchAsync(async (req, res) => {
    const { slotId } = req.params;
    const { desiredTime, serviceId, resourceId, customerPhone } = req.body;
    const userId = req.user.id;
    const notification = await slotService.requestSlotNotification(
        userId, 
        slotId, 
        desiredTime, 
        serviceId, 
        resourceId, 
        customerPhone
    );
    res.status(httpStatus.CREATED).send(notification);
});

const getUserNotifications = catchAsync(async (req, res) => {
    const userId = req.user.id;
    const notifications = await slotService.getUserNotifications(userId);
    res.send(notifications);
});

const deleteNotification = catchAsync(async (req, res) => {
    const userId = req.user.id;
    const { notificationId } = req.params;
    await slotService.deleteNotification(notificationId, userId);
    res.status(httpStatus.NO_CONTENT).send();
});

const bulkCopySlots = catchAsync(async (req, res) => {
    const orgId = req.user.org_id;
    const result = await slotService.bulkCopySlots(orgId, req.body);
    res.status(httpStatus.OK).send(result);
});

module.exports = {
    createSlot,
    getSlots,
    deleteSlot,
    getAvailableSlots,
    requestSlotNotification,
    getUserNotifications,
    deleteNotification,
    bulkCopySlots
};
