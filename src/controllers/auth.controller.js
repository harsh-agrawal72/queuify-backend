const httpStatus = require('../utils/httpStatus');
const catchAsync = require('../utils/catchAsync');
const { authService, tokenService } = require('../services');

const register = catchAsync(async (req, res) => {
    await authService.register(req.body);
    res.status(httpStatus.CREATED).json({
        success: true,
        message: 'Registration successful. Please login.',
    });
});

const login = catchAsync(async (req, res) => {
    const { email, password } = req.body;
    const user = await authService.loginUserWithEmailAndPassword(email, password);
    const tokens = await tokenService.generateAuthTokens(user);
    res.send({ user, tokens });
});

const createOrgAdmin = catchAsync(async (req, res) => {
    const user = await authService.createOrgAdmin(req.body, req.user);
    res.status(httpStatus.CREATED).send({ user });
});

const setPassword = catchAsync(async (req, res) => {
    const { token, newPassword } = req.body;
    const user = await authService.setPassword(token, newPassword);
    res.json({ success: true, message: 'Password set successfully. You can now login.' });
});

module.exports = {
    register,
    login,
    createOrgAdmin,
    setPassword,
    forgotPassword: catchAsync(async (req, res) => {
        await authService.forgotPassword(req.body.email);
        res.json({ success: true, message: 'Password reset link sent to your email.' });
    }),
    resetPassword: catchAsync(async (req, res) => {
        await authService.resetPassword(req.body.token, req.body.password);
        res.json({ success: true, message: 'Password reset successfully.' });
    }),

    googleLogin: catchAsync(async (req, res) => {
        const { token } = req.body;
        const user = await authService.loginWithGoogle(token);
        const tokens = await tokenService.generateAuthTokens(user);
        res.send({ user, tokens });
    }),

    registerOrg: catchAsync(async (req, res) => {
        const { orgName, orgEmail, orgPhone, orgAddress, plan, adminName, adminEmail, password, type } = req.body;
        const orgBody = { orgName, orgEmail, orgPhone, orgAddress, plan, type };
        const adminBody = { name: adminName, email: adminEmail, password };

        const { user, org } = await authService.registerOrganization(orgBody, adminBody);
        const tokens = await tokenService.generateAuthTokens(user);
        res.status(httpStatus.CREATED).send({ user, org, tokens });
    })
};
