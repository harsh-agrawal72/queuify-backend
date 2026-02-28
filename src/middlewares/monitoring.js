const { pool } = require('../config/db');

const monitoringMiddleware = async (req, res, next) => {
    const start = process.hrtime();

    // Listen for the finish event to log success/failure
    res.on('finish', async () => {
        const diff = process.hrtime(start);
        const responseTime = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(3); // ms

        const route = req.route ? req.route.path : req.originalUrl;
        const method = req.method;
        const status = res.statusCode;
        const userId = req.user ? req.user.id : null;
        const orgId = req.user ? req.user.org_id : null;

        // Skip logging for health checks and static assets if any
        if (req.originalUrl.includes('/health') || req.originalUrl.includes('/system')) return;

        try {
            await pool.query(
                'INSERT INTO request_logs (route, method, status, response_time, user_id, org_id) VALUES ($1, $2, $3, $4, $5, $6)',
                [req.originalUrl, method, status, parseFloat(responseTime), userId, orgId]
            );
        } catch (err) {
            console.error('Failed to log request:', err);
        }
    });

    next();
};

const errorLoggingMiddleware = async (err, req, res, next) => {
    const userId = req.user ? req.user.id : null;
    const route = req.originalUrl;
    const method = req.method;
    const statusCode = err.statusCode || res.statusCode || 500;

    try {
        await pool.query(
            'INSERT INTO error_logs (message, stack, route, method, status_code, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
            [err.message, err.stack, route, method, statusCode, userId]
        );
    } catch (dbErr) {
        console.error('Failed to log error to DB:', dbErr);
    }

    next(err);
};

module.exports = {
    monitoringMiddleware,
    errorLoggingMiddleware
};
