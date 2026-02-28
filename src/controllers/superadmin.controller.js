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
        // Default: Aggregated View
        const stats = await superadminService.getGlobalBookingStats();
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
    const org = await superadminService.suspendOrganization(req.params.orgId);
    res.send(org);
});

const activateOrganization = catchAsync(async (req, res) => {
    console.log('[Superadmin Activate] Request received', { orgId: req.params.orgId });
    const org = await superadminService.activateOrganization(req.params.orgId);
    res.send(org);
});

const getRecentActivity = catchAsync(async (req, res) => {
    const logs = await superadminService.getRecentActivity();
    res.send(logs);
});

const getGlobalMonitor = catchAsync(async (req, res) => {
    const data = await superadminService.getGlobalMonitorData();
    res.send(data);
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
    deleteAdmin
};
