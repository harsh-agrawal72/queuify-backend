const httpStatus = require('../utils/httpStatus');
const catchAsync = require('../utils/catchAsync');
const userService = require('../services/user.service');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

const getUserStats = catchAsync(async (req, res) => {
    const stats = await userService.getUserStats(req.user.id);
    res.send(stats);
});

const updateProfile = catchAsync(async (req, res) => {
    const user = await userService.updateProfile(req.user.id, req.body);
    res.send(user);
});

const deleteAccount = catchAsync(async (req, res) => {
    const { password } = req.body;
    if (!password) {
        return res.status(400).json({ message: 'Password is required to delete your account' });
    }

    // Verify password before deletion
    const userRes = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (userRes.rows.length === 0) {
        return res.status(404).json({ message: 'User not found' });
    }
    const isMatch = await bcrypt.compare(password, userRes.rows[0].password_hash);
    if (!isMatch) {
        return res.status(401).json({ message: 'Incorrect password' });
    }

    await userService.deleteAccount(req.user.id);
    res.status(200).json({ success: true, message: 'Account deleted successfully' });
});

const uploadProfilePicture = catchAsync(async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
    }
    const result = await userService.saveProfileImage(req.user.id, req.file);
    res.status(200).send(result);
});

const getUserImage = catchAsync(async (req, res) => {
    const { imageId } = req.params;
    const image = await userService.getProfileImage(imageId);
    res.set('Content-Type', image.mime_type);
    res.send(image.image_data);
});

module.exports = {
    getUserStats,
    updateProfile,
    deleteAccount,
    uploadProfilePicture,
    getUserImage
};

