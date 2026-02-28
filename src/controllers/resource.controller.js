const httpStatus = require('../utils/httpStatus');
const catchAsync = require('../utils/catchAsync');
const resourceService = require('../services/resource.service');

const createResource = catchAsync(async (req, res) => {
    const resource = await resourceService.createResource(req.user.org_id, req.body);
    res.status(httpStatus.CREATED).send(resource);
});

const getResources = catchAsync(async (req, res) => {
    const resources = await resourceService.getResources(req.user.org_id);
    res.send(resources);
});

const getResource = catchAsync(async (req, res) => {
    const resource = await resourceService.getResourceById(req.user.org_id, req.params.resourceId);
    res.send(resource);
});

const getResourcesByService = catchAsync(async (req, res) => {
    const resources = await resourceService.getResourcesByServiceId(req.params.serviceId, true);
    res.send(resources);
});

const updateResource = catchAsync(async (req, res) => {
    const resource = await resourceService.updateResource(req.user.org_id, req.params.resourceId, req.body);
    res.send(resource);
});

const deleteResource = catchAsync(async (req, res) => {
    await resourceService.deleteResource(req.user.org_id, req.params.resourceId);
    res.status(httpStatus.NO_CONTENT).send();
});

const getResourcesByOrg = catchAsync(async (req, res) => {
    const resources = await resourceService.getResources(req.params.orgId, true);
    res.send(resources);
});

const linkResource = catchAsync(async (req, res) => {
    const { resourceId, serviceIds } = req.body;
    await resourceService.linkResourceToServices(resourceId, serviceIds);
    res.status(httpStatus.OK).send({ message: 'Linked successfully' });
});

const unlinkResource = catchAsync(async (req, res) => {
    const { resourceId, serviceId } = req.body;
    await resourceService.unlinkResourceFromService(resourceId, serviceId);
    res.status(httpStatus.OK).send({ message: 'Unlinked successfully' });
});

module.exports = {
    createResource,
    getResources,
    getResource,
    getResourcesByService,
    updateResource,
    deleteResource,
    getResourcesByOrg,
    linkResource,
    unlinkResource
};
