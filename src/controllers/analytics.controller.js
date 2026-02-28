const catchAsync = require('../utils/catchAsync');
const { pool } = require('../config/db');

const getBasicAnalytics = catchAsync(async (req, res) => {
    // Only accessible by Admin/Superadmin (to be enforced by route)

    // 1. Total Appointments (Today)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayRes = await pool.query(
        'SELECT COUNT(*) FROM appointments WHERE created_at >= $1 AND created_at < $2',
        [today.toISOString(), tomorrow.toISOString()]
    );

    // 2. Breakdown by Status
    const statusRes = await pool.query(
        'SELECT status, COUNT(*) FROM appointments GROUP BY status'
    );

    // 3. User Count
    const userRes = await pool.query('SELECT COUNT(*) FROM users WHERE role = $1', ['user']);

    res.send({
        appointmentsToday: parseInt(todayRes.rows[0].count),
        statusDistribution: statusRes.rows.reduce((acc, row) => {
            acc[row.status] = parseInt(row.count);
            return acc;
        }, {}),
        totalUsers: parseInt(userRes.rows[0].count)
    });
});

module.exports = {
    getBasicAnalytics
};
