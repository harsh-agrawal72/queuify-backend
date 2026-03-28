const httpStatus = require('../utils/httpStatus');
const catchAsync = require('../utils/catchAsync');
const { adminService, reassignmentService } = require('../services');

const getOverview = catchAsync(async (req, res) => {
    const stats = await adminService.getOverview(req.user.org_id);
    res.send(stats);
});

const getOrgDetails = catchAsync(async (req, res) => {
    const org = await adminService.getOrgDetails(req.user.org_id);
    res.send(org);
});

const updateOrgDetails = catchAsync(async (req, res) => {
    const org = await adminService.updateOrgDetails(req.user.org_id, req.body);
    res.json({ success: true, data: org });
});

const getTodayQueue = catchAsync(async (req, res) => {
    const queue = await adminService.getTodayQueue(req.user.org_id);
    res.send(queue);
});

const getAnalytics = catchAsync(async (req, res) => {
    const filters = {
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        serviceId: req.query.serviceId,
        resourceId: req.query.resourceId,
    };
    const analytics = await adminService.getAnalytics(req.user.org_id, filters);
    res.send(analytics);
});

const getSlots = catchAsync(async (req, res) => {
    const slots = await adminService.getSlots(req.user.org_id, req.query.resourceId, req.query.date);
    res.send(slots);
});

const createSlot = catchAsync(async (req, res) => {
    const slot = await adminService.createSlot(req.user.org_id, req.body);
    res.status(httpStatus.CREATED).json({ success: true, data: slot });
});

const updateSlot = catchAsync(async (req, res) => {

    const slot = await adminService.updateSlot(req.user.org_id, req.params.slotId, req.body);
    res.json({ success: true, message: "Slot updated successfully", data: slot });
});

const deleteSlot = catchAsync(async (req, res) => {
    const deletedSlot = await adminService.deleteSlot(req.user.org_id, req.params.slotId);
    res.status(httpStatus.OK).json({ success: true, data: deletedSlot });
});

const getAppointments = catchAsync(async (req, res) => {
    const appointments = await adminService.getAppointments(req.user.org_id, req.query);
    res.send(appointments);
});

const updateAppointmentStatus = catchAsync(async (req, res) => {
    const { status, reason = null } = req.body;
    const appointment = await adminService.updateAppointmentStatus(req.user.org_id, req.params.appointmentId, status, reason);
    res.json({ success: true, data: appointment });
});

const deleteAppointment = catchAsync(async (req, res) => {
    const { reason = null } = req.body;
    const appointment = await adminService.deleteAppointment(req.user.org_id, req.params.appointmentId, reason);
    res.json({ success: true, data: appointment });
});

const getLiveQueue = catchAsync(async (req, res) => {
    const queue = await adminService.getLiveQueue(req.user.org_id, req.query.date);
    res.send(queue);
});

const getNotifications = catchAsync(async (req, res) => {
    const notifications = await adminService.getNotifications(req.user.id);
    res.send(notifications);
});

const markAllNotificationsAsRead = catchAsync(async (req, res) => {
    await adminService.markAllNotificationsAsRead(req.user.id);
    res.status(httpStatus.NO_CONTENT).send();
});

const globalSearch = catchAsync(async (req, res) => {
    const results = await adminService.globalSearch(req.user.org_id, req.query.q);
    res.send(results);
});

const getAdmins = catchAsync(async (req, res) => {
    const admins = await adminService.getAdmins(req.user.org_id);
    res.send(admins);
});

const inviteAdmin = catchAsync(async (req, res) => {
    const admin = await adminService.inviteAdmin(req.body, req.user.id, req.user.org_id);
    res.status(httpStatus.CREATED).send(admin);
});

const deleteAdmin = catchAsync(async (req, res) => {
    await adminService.deleteAdmin(req.params.adminId, req.user.id, req.user.org_id);
    res.status(httpStatus.NO_CONTENT).send();
});

const deleteOrganization = catchAsync(async (req, res) => {
    const { confirmText } = req.body;
    if (confirmText !== 'DELETE') {
        return res.status(400).json({ message: 'Please type DELETE to confirm' });
    }
    await adminService.deleteOrganization(req.user.org_id);
    res.status(200).json({ success: true, message: 'Organization deleted successfully' });
});

const rebalanceSlots = catchAsync(async (req, res) => {
    const { resourceId } = req.params;
    const { date } = req.query; // YYYY-MM-DD
    
    if (!resourceId || !date) {
        return res.status(400).json({ message: 'resourceId and date are required' });
    }

    const result = await reassignmentService.rebalanceResourceSlots(resourceId, date);
    res.json({ success: true, ...result });
});

const getPredictiveInsights = catchAsync(async (req, res) => {
    const insights = await adminService.getPredictiveInsights(req.user.org_id);
    res.send(insights);
});

const createManualAppointment = catchAsync(async (req, res) => {
    const appointment = await adminService.createManualAppointment(req.user.org_id, req.body);
    res.status(httpStatus.CREATED).json({ success: true, data: appointment });
});

const getUserLoyalty = catchAsync(async (req, res) => {
    const loyalty = await adminService.getUserLoyalty(req.user.org_id, req.params.userId);
    res.send(loyalty);
});

const getUserHistory = catchAsync(async (req, res) => {
    const history = await adminService.getUserHistory(req.user.org_id, req.params.userId);
    res.send(history);
});

module.exports = {
    getOverview,
    getOrgDetails,
    updateOrgDetails,
    getTodayQueue,
    getAnalytics,
    getSlots,
    createSlot,
    updateSlot,
    deleteSlot,
    getAppointments,
    updateAppointmentStatus,
    deleteAppointment,
    getLiveQueue,
    getNotifications,
    markAllNotificationsAsRead,
    globalSearch,
    getAdmins,
    inviteAdmin,
    deleteAdmin,
    deleteOrganization,
    rebalanceSlots,
    getPredictiveInsights,
    createManualAppointment,
    getUserLoyalty,
    getUserHistory
};
