const Joi = require('joi');

const submitReview = {
    body: Joi.object().keys({
        appointment_id: Joi.string().uuid().required(),
        rating: Joi.number().integer().min(1).max(5).required(),
        comment: Joi.string().allow('', null).optional()
    })
};

const getOrgReviews = {
    params: Joi.object().keys({
        orgId: Joi.string().uuid().required()
    })
};

module.exports = {
    submitReview,
    getOrgReviews
};
