const httpStatus = require('../utils/httpStatus');
const catchAsync = require('../utils/catchAsync');
const { superadminService } = require('../services');

const getOverview = catchAsync(async (req, res) => {
    const stats = await superadminService.getGlobalOverview();
    res.send(stats);
});

const getAnalytics = catchAsync(async (req, res) => {
    const global = await superadminService.getGlobalAnalytics();
    const advanced = await superadminService.getAdvancedAnalytics();
    res.send({ ...global, ...advanced });
});

const getOrganizations = catchAsync(async (req, res) => {
    const orgs = await superadminService.getOrganizations();
    res.send(orgs);
});

const createOrganization = catchAsync(async (req, res) => {
    const org = await superadminService.createOrganization(req.body);
    res.status(httpStatus.CREATED).send(org);
});

const updateOrganization = catchAsync(async (req, res) => {
    const org = await superadminService.updateOrganization(req.params.orgId, req.body);
    res.send(org);
});

const permanentDeleteOrganization = catchAsync(async (req, res) => {
    await superadminService.permanentDeleteOrganization(req.params.orgId);
    res.status(httpStatus.NO_CONTENT).send();
});

const getAdmins = catchAsync(async (req, res) => {
    const filters = {
        search: req.query.search,
        orgId: req.query.orgId,
        status: req.query.status
    };
    const options = {
        page: parseInt(req.query.page, 10) || 1,
        limit: parseInt(req.query.limit, 10) || 20
    };
    const result = await superadminService.getAdmins(filters, options);
    res.send(result);
});

const inviteAdmin = catchAsync(async (req, res) => {
    const admin = await superadminService.inviteAdmin(req.body, req.user.id);
    res.status(httpStatus.CREATED).send(admin);
});

const resendInvite = catchAsync(async (req, res) => {
    const result = await superadminService.resendInvite(req.params.id, req.user.id);
    res.send(result);
});

const updateAdminStatus = catchAsync(async (req, res) => {
    const admin = await superadminService.updateAdminStatus(req.params.id, req.body.status, req.user.id);
    res.send(admin);
});

const deleteAdmin = catchAsync(async (req, res) => {
    await superadminService.deleteAdmin(req.params.id, req.user.id);
    res.status(httpStatus.NO_CONTENT).send();
});

const getGlobalAppointments = catchAsync(async (req, res) => {
    const { mode, orgId } = req.query;

    if (mode === 'detailed' && orgId) {
        const filters = {
            status: req.query.status
        };
        const options = {
            page: parseInt(req.query.page, 10) || 1,
            limit: parseInt(req.query.limit, 10) || 20
        };
        const result = await superadminService.getOrgBookings(orgId, filters, options);
        res.send(result);
    } else {
        // Default: Aggregated View (or search)
        const stats = await superadminService.getGlobalBookingStats(req.query.search);
        res.send(stats);
    }
});

const cancelAppointment = catchAsync(async (req, res) => {
    const appointment = await superadminService.cancelAnyAppointment(req.params.id);
    res.send(appointment);
});

const getSystemHealth = catchAsync(async (req, res) => {
    const health = await superadminService.getSystemHealth();
    res.send(health);
});

const impersonateAdmin = catchAsync(async (req, res) => {
    console.log('[Superadmin Impersonate] Request received', {
        orgId: req.params.orgId,
        superadminId: req.user?.id,
        userRole: req.user?.role
    });

    // req.user.id is the superadmin's ID from the auth middleware
    const result = await superadminService.impersonateOrgAdmin(req.params.orgId, req.user.id);
    res.send(result);
});

const suspendOrganization = catchAsync(async (req, res) => {
    console.log('[Superadmin Suspend] Request received', { orgId: req.params.orgId });
    const org = await superadminService.suspendOrganization(req.params.orgId, req.user.id);
    res.send(org);
});

const activateOrganization = catchAsync(async (req, res) => {
    console.log('[Superadmin Activate] Request received', { orgId: req.params.orgId });
    const org = await superadminService.activateOrganization(req.params.orgId, req.user.id);
    res.send(org);
});

const verifyOrganization = catchAsync(async (req, res) => {
    const result = await superadminService.verifyOrganization(req.params.orgId, req.user.id);
    res.send(result);
});

const unverifyOrganization = catchAsync(async (req, res) => {
    const result = await superadminService.unverifyOrganization(req.params.orgId, req.user.id);
    res.send(result);
});

const getRecentActivity = catchAsync(async (req, res) => {
    const logs = await superadminService.getRecentActivity();
    res.send(logs);
});

const getGlobalMonitor = catchAsync(async (req, res) => {
    const data = await superadminService.getGlobalMonitorData();
    res.send(data);
});

const getRevenueAnalytics = catchAsync(async (req, res) => {
    const data = await superadminService.getRevenueAnalytics();
    res.send(data);
});

const getOrgHealthScores = catchAsync(async (req, res) => {
    const data = await superadminService.getOrgHealthScores();
    res.send(data);
});

const getPlatformAuditTrail = catchAsync(async (req, res) => {
    const filters = {
        action: req.query.action,
        orgId: req.query.orgId
    };
    const options = {
        page: parseInt(req.query.page, 10) || 1,
        limit: parseInt(req.query.limit, 10) || 50
    };
    const data = await superadminService.getPlatformAuditTrail(filters, options);
    res.send(data);
});

const sendBroadcast = catchAsync(async (req, res) => {
    const result = await superadminService.sendBroadcast(req.body, req.user.id);
    res.status(httpStatus.CREATED).send(result);
});

const getBroadcastHistory = catchAsync(async (req, res) => {
    const history = await superadminService.getBroadcastHistory();
    res.send(history);
});

const getPayoutRequests = catchAsync(async (req, res) => {
    const filters = { status: req.query.status };
    const requests = await superadminService.getPayoutRequests(filters);
    res.send(requests);
});

const updatePayoutStatus = catchAsync(async (req, res) => {
    const { status, reason } = req.body;
    const { payoutId } = req.params;
    
    let result;
    const payoutService = require('../services/payout.service');
    
    if (status === 'completed') {
        result = await payoutService.completeManualPayout(payoutId, req.user.id);
    } else if (status === 'rejected') {
        result = await payoutService.rejectManualPayout(payoutId, reason, req.user.id);
    } else {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid status update');
    }
    
    res.send(result);
});

module.exports = {
    getOverview,
    getGlobalMonitor,
    getAnalytics,
    getOrganizations,
    createOrganization,
    updateOrganization,
    permanentDeleteOrganization,
    getAdmins,
    getGlobalAppointments,
    cancelAppointment,
    getSystemHealth,
    impersonateAdmin,
    suspendOrganization,
    activateOrganization,
    getRecentActivity,
    inviteAdmin,
    resendInvite,
    updateAdminStatus,
    deleteAdmin,
    verifyOrganization,
    unverifyOrganization,
    getRevenueAnalytics,
    getOrgHealthScores,
    getPlatformAuditTrail,
    sendBroadcast,
    getBroadcastHistory,
    getPayoutRequests,
    updatePayoutStatus
};
