const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const userController = require('../../controllers/user.controller');

const upload = require('../../utils/upload');

const router = express.Router();

router.get('/stats', auth('user'), userController.getUserStats);
router.patch('/profile', auth('user'), userController.updateProfile);
router.get('/profile/image/:imageId', userController.getUserImage);
router.post('/profile/image', auth('user'), upload.single('profile_picture'), userController.uploadProfilePicture);
router.delete('/account', auth('user'), userController.deleteAccount);

module.exports = router;

