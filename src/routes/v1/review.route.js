const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const reviewValidation = require('../../validations/review.validation');
const reviewController = require('../../controllers/review.controller');

const router = express.Router();

router.post('/', auth('user'), validate(reviewValidation.submitReview), reviewController.submitReview);
router.get('/organization/:orgId', validate(reviewValidation.getOrgReviews), reviewController.getOrgReviews);

module.exports = router;
