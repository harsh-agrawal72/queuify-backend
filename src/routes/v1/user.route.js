const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const userController = require('../../controllers/user.controller');

const router = express.Router();

router.get('/stats', auth('user'), userController.getUserStats);
router.patch('/profile', auth('user'), userController.updateProfile);

module.exports = router;
