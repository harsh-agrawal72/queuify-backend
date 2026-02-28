const express = require('express');
const validate = require('../../middlewares/validate');
const authValidation = require('../../validations/auth.validation');
const { authController } = require('../../controllers');
const auth = require('../../middlewares/auth');

const router = express.Router();

// Public routes
router.post('/register', validate(authValidation.register), authController.register);
router.post('/login', validate(authValidation.login), authController.login);
router.post('/google-login', validate(authValidation.googleLogin), authController.googleLogin);
router.post('/register-org', validate(authValidation.registerOrg), authController.registerOrg);

// Superadmin-only: create org admin
router.post('/create-org-admin', auth('superadmin'), validate(authValidation.createOrgAdmin), authController.createOrgAdmin);

// Token-based password flows
router.post('/forgot-password', validate(authValidation.forgotPassword), authController.forgotPassword);
router.post('/reset-password', validate(authValidation.resetPassword), authController.resetPassword);
router.post('/set-password', validate(authValidation.setPassword), authController.setPassword);

// 405 for GET on auth endpoints
router.get('/register', (req, res) => {
    res.status(405).json({ success: false, message: 'Method Not Allowed. Use POST to register.' });
});
router.get('/login', (req, res) => {
    res.status(405).json({ success: false, message: 'Method Not Allowed. Use POST to login.' });
});

module.exports = router;
