const organizationImageModel = require('../models/organization_image.model');
const fs = require('fs');
const path = require('path');

/**
 * Handle image upload and model entry
 */
const uploadImage = async (orgId, file, imageType) => {
    // If it's a logo or cover, delete existing ones of that type
    if (imageType === 'logo' || imageType === 'cover') {
        await organizationImageModel.deleteImagesByType(orgId, imageType);
    }

    // We no longer generate a file URL on disk. 
    // Instead, we store the binary data and return an internal API URL.
    const image = await organizationImageModel.addImage(
        orgId,
        null, // No image_url (file path) anymore
        imageType,
        file.buffer, // Binary data from memoryStorage
        file.mimetype // To set correct Content-Type header when serving
    );

    return {
        ...image,
        image_url: `/v1/organizations/image/${image.id}` // Internal route
    };
};

/**
 * Delete image
 */
const deleteImage = async (imageId, orgId) => {
    return organizationImageModel.deleteImage(imageId, orgId);
};

module.exports = {
    uploadImage,
    deleteImage
};
