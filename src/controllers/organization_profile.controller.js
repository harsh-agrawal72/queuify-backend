const httpStatus = require('../utils/httpStatus');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');
const organizationProfileService = require('../services/organization_profile.service');
const organizationImageService = require('../services/organization_image.service');

const getProfile = catchAsync(async (req, res) => {
    const orgId = req.user.org_id;
    if (!orgId) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'User is not associated with an organization');
    }
    const profile = await organizationProfileService.getFullProfile(orgId);
    res.send(profile);
});

const getPublicProfile = catchAsync(async (req, res) => {
    const { orgId } = req.params;
    const profile = await organizationProfileService.getFullProfile(orgId);
    res.send(profile);
});

const updateProfile = catchAsync(async (req, res) => {
    const orgId = req.user.org_id;
    if (!orgId) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'User is not associated with an organization');
    }
    const profile = await organizationProfileService.updateProfile(orgId, req.body);
    res.send(profile);
});

const uploadImages = catchAsync(async (req, res) => {
    const orgId = req.user.org_id;
    if (!orgId) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'User is not associated with an organization');
    }
    const { type: imageType } = req.body;

    if (!req.file && (!req.files || req.files.length === 0)) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'No images uploaded');
    }

    const results = [];
    if (req.file) {
        const img = await organizationImageService.uploadImage(orgId, req.file, imageType || 'gallery');
        results.push(img);
    } else if (req.files) {
        // req.files is an object with keys matching field names
        for (const fieldName in req.files) {
            for (const file of req.files[fieldName]) {
                const img = await organizationImageService.uploadImage(orgId, file, fieldName);
                results.push(img);
            }
        }
    }

    res.send(results);
});

const deleteImage = catchAsync(async (req, res) => {
    const orgId = req.user.org_id;
    if (!orgId) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'User is not associated with an organization');
    }
    const { id } = req.params;
    const img = await organizationImageService.deleteImage(id, orgId);
    if (!img) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Image not found or not owned by your organization');
    }
    res.send(img);
});

module.exports = {
    getProfile,
    getPublicProfile,
    updateProfile,
    uploadImages,
    deleteImage
};
