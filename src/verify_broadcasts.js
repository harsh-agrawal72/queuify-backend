const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB || process.env.POSTGRES_DATABASE,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        console.log('--- DB Config Check ---');
        console.log('Host:', process.env.POSTGRES_HOST);

        const users = await pool.query("SELECT role, is_suspended, notification_enabled, COUNT(*) FROM users GROUP BY role, is_suspended, notification_enabled");
        console.log('User stats:', JSON.stringify(users.rows, null, 2));

        const notifs = await pool.query(`
            SELECT n.id, n.title, n.type, u.role, u.name 
            FROM notifications n 
            JOIN users u ON n.user_id = u.id 
            WHERE n.type IN ('info', 'success', 'warning', 'emergency', 'broadcast') 
            ORDER BY n.created_at DESC 
            LIMIT 10
        `);
        console.log('Latest notifications:', JSON.stringify(notifs.rows, null, 2));

        const logs = await pool.query("SELECT id, target, title, type, created_at FROM broadcast_logs ORDER BY created_at DESC LIMIT 5");
        console.log('Broadcast logs:', JSON.stringify(logs.rows, null, 2));

    } catch (err) {
        console.error('DEBUG ERROR:', err.message);
    } finally {
        await pool.end();
    }
}

run();
