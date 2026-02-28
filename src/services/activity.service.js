const { pool } = require('../config/db');

const logActivity = async (userId, action, details, ipAddress) => {
    try {
        await pool.query(
            'INSERT INTO activity_logs (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
            [userId, action, details, ipAddress]
        );
    } catch (error) {
        console.error('Failed to log activity:', error);
        // Don't throw, we don't want to break the main action if logging fails
    }
};

const getRecentActivity = async (limit = 20) => {
    const res = await pool.query(`
        SELECT al.*, u.name as user_name, u.email as user_email
        FROM activity_logs al
        LEFT JOIN users u ON al.user_id = u.id
        ORDER BY al.created_at DESC
        LIMIT $1
    `, [limit]);
    return res.rows;
};

module.exports = {
    logActivity,
    getRecentActivity
};
