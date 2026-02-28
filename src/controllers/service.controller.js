const httpStatus = require('../utils/httpStatus');
const catchAsync = require('../utils/catchAsync');
const serviceService = require('../services/service.service');

const createService = catchAsync(async (req, res) => {
    const service = await serviceService.createService(req.user.org_id, req.body);
    res.status(httpStatus.CREATED).send(service);
});

const getServices = catchAsync(async (req, res) => {
    const services = await serviceService.getServices(req.user.org_id);
    res.send(services);
});

const getService = catchAsync(async (req, res) => {
    const service = await serviceService.getServiceById(req.user.org_id, req.params.serviceId);
    res.send(service);
});

const updateService = catchAsync(async (req, res) => {
    const service = await serviceService.updateService(req.user.org_id, req.params.serviceId, req.body);
    res.send(service);
});

const deleteService = catchAsync(async (req, res) => {
    await serviceService.deleteService(req.user.org_id, req.params.serviceId);
    res.status(httpStatus.NO_CONTENT).send();
});

const getServicesByOrg = catchAsync(async (req, res) => {
    console.log('Fetching services for orgId:', req.params.orgId);
    const services = await serviceService.getServices(req.params.orgId, true);
    res.send(services);
});

module.exports = {
    createService,
    getServices,
    getService,
    updateService,
    deleteService,
    getServicesByOrg
};
