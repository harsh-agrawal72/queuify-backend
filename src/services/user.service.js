const httpStatus = require('../utils/httpStatus');
const { pool } = require('../config/db');
const ApiError = require('../utils/ApiError');
const bcrypt = require('bcryptjs');
const appointmentService = require('./appointment.service');

/**
 * Get user statistics
 * @param {string} userId
 * @returns {Promise<Object>}
 */
const getUserStats = async (userId) => {
    // 1. Total Appointments
    const totalRes = await pool.query(
        'SELECT COUNT(*) FROM appointments WHERE user_id = $1',
        [userId]
    );

    // 2. Upcoming (status in ['confirmed', 'pending', 'serving'] AND start_time > NOW())
    const upcomingRes = await pool.query(`
        SELECT COUNT(*) FROM appointments a
        JOIN slots s ON a.slot_id = s.id
        WHERE a.user_id = $1 
        AND a.status IN ('confirmed', 'pending', 'serving')
        AND s.start_time > NOW()
    `, [userId]);

    // 3. Completed (status = 'completed' OR status = 'no_show')
    const completedRes = await pool.query(
        "SELECT COUNT(*) FROM appointments WHERE user_id = $1 AND status IN ('completed', 'no_show')",
        [userId]
    );

    // 4. Cancelled
    const cancelledRes = await pool.query(
        "SELECT COUNT(*) FROM appointments WHERE user_id = $1 AND status = 'cancelled'",
        [userId]
    );

    // 5. Next Appointment
    const nextApptRes = await pool.query(`
        SELECT a.*, s.start_time, s.end_time, svc.name as service_name, org.name as org_name
        FROM appointments a
        JOIN slots s ON a.slot_id = s.id
        LEFT JOIN services svc ON a.service_id = svc.id
        LEFT JOIN organizations org ON a.org_id = org.id
        WHERE a.user_id = $1 
        AND a.status IN ('confirmed', 'pending', 'serving')
        AND s.end_time > NOW()
        ORDER BY s.start_time ASC
        LIMIT 1
    `, [userId]);

    let nextAppointment = nextApptRes.rows[0] || null;

    if (nextAppointment) {
        try {
            const status = await appointmentService.getQueueStatus(nextAppointment.id);
            nextAppointment.people_ahead = status.people_ahead || 0;
            nextAppointment.estimated_wait_time = status.estimated_wait_time || 0;
            nextAppointment.current_serving_number = status.current_serving_number || 0;
            nextAppointment.queue_number = status.queue_number || 0;
        } catch (e) {
            console.error('Failed to attach queue status to next appointment:', e);
        }
    }

    // 6. Recent unreviewed / completed appointments
    const recentCompletedRes = await pool.query(`
        SELECT a.id, a.status, s.start_time, svc.name as service_name, org.name as org_name, rv.id as review_id, rv.rating as review_rating
        FROM appointments a
        JOIN slots s ON a.slot_id = s.id
        LEFT JOIN services svc ON a.service_id = svc.id
        LEFT JOIN organizations org ON a.org_id = org.id
        LEFT JOIN reviews rv ON a.id = rv.appointment_id
        WHERE a.user_id = $1 
        AND a.status = 'completed'
        ORDER BY s.start_time DESC
        LIMIT 3
    `, [userId]);

    return {
        total: parseInt(totalRes.rows[0].count),
        upcoming: parseInt(upcomingRes.rows[0].count),
        completed: parseInt(completedRes.rows[0].count),
        cancelled: parseInt(cancelledRes.rows[0].count),
        nextAppointment,
        recentCompleted: recentCompletedRes.rows
    };
};

/**
 * Update user profile
 * @param {string} userId
 * @param {Object} updateBody
 * @returns {Promise<Object>}
 */
const updateProfile = async (userId, updateBody) => {
    const { name, password, email, email_notification_enabled, notification_enabled } = updateBody;

    // Build query dynamically
    let query = 'UPDATE users SET updated_at = NOW()';
    const params = [userId];
    let idx = 2;

    if (name) {
        query += `, name = $${idx}`;
        params.push(name);
        idx++;
    }

    if (password) {
        const hashedPassword = await bcrypt.hash(password, 8);
        query += `, password_hash = $${idx}`;
        params.push(hashedPassword);
        idx++;
    }

    // Email update is sensitive, usually requires verification, but allowing for now if needed
    // Assuming email is unique constraint in DB will handle duplicates
    if (email) {
        query += `, email = $${idx}`;
        params.push(email);
        idx++;
    }

    if (email_notification_enabled !== undefined) {
        query += `, email_notification_enabled = $${idx}`;
        params.push(email_notification_enabled);
        idx++;
    }

    if (notification_enabled !== undefined) {
        query += `, notification_enabled = $${idx}`;
        params.push(notification_enabled);
        idx++;
    }

    if (updateBody.phone !== undefined) {
        query += `, phone = $${idx}`;
        params.push(updateBody.phone);
        idx++;
    }

    if (updateBody.profile_picture_url !== undefined) {
        query += `, profile_picture_url = $${idx}`;
        params.push(updateBody.profile_picture_url);
        idx++;
    }

    if (updateBody.address !== undefined) {
        query += `, address = $${idx}`;
        params.push(updateBody.address);
        idx++;
    }

    if (updateBody.city !== undefined) {
        query += `, city = $${idx}`;
        params.push(updateBody.city);
        idx++;
    }

    if (updateBody.state !== undefined) {
        query += `, state = $${idx}`;
        params.push(updateBody.state);
        idx++;
    }

    if (updateBody.pincode !== undefined) {
        query += `, pincode = $${idx}`;
        params.push(updateBody.pincode);
        idx++;
    }

    query += ' WHERE id = $1 RETURNING id, name, email, role, phone, profile_picture_url, address, city, state, pincode, email_notification_enabled, notification_enabled, created_at';

    try {
        const result = await pool.query(query, params);
        if (result.rows.length === 0) {
            throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
        }
        return result.rows[0];
    } catch (error) {
        if (error.code === '23505') { // Unique violation
            throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
        }
        throw error;
    }
};


/**
 * Delete user account permanently
 * Cancels active appointments and removes user record
 */
const deleteAccount = async (userId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Cancel all active appointments before deleting
        await client.query(
            `UPDATE appointments 
             SET status = 'cancelled', cancelled_by = 'user', updated_at = NOW()
             WHERE user_id = $1 AND status IN ('confirmed', 'pending')`,
            [userId]
        );

        // Hard delete the user (appointments keep user_id as null via SET NULL if FK allows, else cascade)
        const res = await client.query('DELETE FROM users WHERE id = $1 RETURNING id, name, email', [userId]);
        if (res.rows.length === 0) {
            throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
        }

        await client.query('COMMIT');
        return res.rows[0];
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('[deleteAccount] Error:', e);
        throw e;
    } finally {
        client.release();
    }
};

/**
 * Save user profile image
 * @param {string} userId
 * @param {Object} file - Express file object (Multer)
 * @returns {Promise<Object>}
 */
const saveProfileImage = async (userId, file) => {
    const { buffer, mimetype } = file;
    
    // Optional: Delete previous image(s) to save space
    await pool.query('DELETE FROM user_images WHERE user_id = $1', [userId]);

    const query = 'INSERT INTO user_images (user_id, image_data, mime_type) VALUES ($1, $2, $3) RETURNING id';
    const result = await pool.query(query, [userId, buffer, mimetype]);
    
    // Update users.profile_picture_url with a public-facing URL
    // We use a relative URL that the frontend can append to its base URL
    const imageUrl = `/v1/users/profile/image/${result.rows[0].id}`;
    await pool.query('UPDATE users SET profile_picture_url = $1 WHERE id = $2', [imageUrl, userId]);
    
    return { id: result.rows[0].id, url: imageUrl };
};

/**
 * Get user profile image
 * @param {string} imageId
 * @returns {Promise<Object>}
 */
const getProfileImage = async (imageId) => {
    const query = 'SELECT image_data, mime_type FROM user_images WHERE id = $1';
    const result = await pool.query(query, [imageId]);
    if (result.rows.length === 0) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Image not found');
    }
    return result.rows[0];
};

module.exports = {
    getUserStats,
    updateProfile,
    deleteAccount,
    saveProfileImage,
    getProfileImage
};

