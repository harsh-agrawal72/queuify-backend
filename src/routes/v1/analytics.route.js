const express = require('express');
const auth = require('../../middlewares/auth');
const analyticsController = require('../../controllers/analytics.controller');

const router = express.Router();

router
    .route('/')
    .get(auth('admin'), analyticsController.getBasicAnalytics);

module.exports = router;
