/**
 * keepAlive.js — Render Cold Start Prevention
 *
 * Pings the backend's own /health endpoint every 10 minutes
 * so Render's free tier doesn't spin down the server.
 * This eliminates "first request fails" issues for users.
 */

const cron = require('node-cron');
const https = require('https');
const http = require('http');
const config = require('../config/config');

const init = () => {
    const baseUrl = config.baseUrl || `http://localhost:${config.port || 5000}`;
    const healthUrl = `${baseUrl}/health`;

    // Run every 10 minutes
    cron.schedule('*/10 * * * *', () => {
        const protocol = healthUrl.startsWith('https') ? https : http;

        const req = protocol.get(healthUrl, (res) => {
            // Consume response data to free socket
            res.resume();
            if (res.statusCode === 200) {
                console.log(`[KeepAlive] ✅ Ping OK (${new Date().toISOString()})`);
            } else {
                console.warn(`[KeepAlive] ⚠️ Ping returned status ${res.statusCode}`);
            }
        });

        req.on('error', (err) => {
            console.warn(`[KeepAlive] ⚠️ Ping failed: ${err.message}`);
        });

        // Don't wait forever
        req.setTimeout(8000, () => {
            req.destroy();
            console.warn('[KeepAlive] ⚠️ Ping timed out after 8s');
        });
    }, {
        scheduled: true,
        timezone: 'Asia/Kolkata'
    });

    console.log('[KeepAlive] 🔄 Self-ping cron started (every 10 min) to prevent cold starts.');
};

module.exports = { init };
