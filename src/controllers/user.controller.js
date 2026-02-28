const httpStatus = require('../utils/httpStatus');
const catchAsync = require('../utils/catchAsync');
const userService = require('../services/user.service');

const getUserStats = catchAsync(async (req, res) => {
    const stats = await userService.getUserStats(req.user.id);
    res.send(stats);
});

const updateProfile = catchAsync(async (req, res) => {
    const user = await userService.updateProfile(req.user.id, req.body);
    res.send(user);
});

module.exports = {
    getUserStats,
    updateProfile
};
