const { Pool } = require('pg');
require('dotenv').config({ path: './.env' });

const poolConfig = {
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB || process.env.POSTGRES_DATABASE,
};

// Only add SSL if required by the error we saw
if (process.env.POSTGRES_SSL === 'true' || process.env.DATABASE_URL?.includes('render.com')) {
    poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

async function checkBroadcasts() {
    try {
        console.log('Checking notifications table for broadcasts...');
        const res = await pool.query(`
            SELECT n.*, u.name as user_name, u.role
            FROM notifications n
            JOIN users u ON n.user_id = u.id
            WHERE n.type IN ('info', 'success', 'warning', 'emergency', 'broadcast')
            ORDER BY n.created_at DESC
            LIMIT 20
        `);
        
        console.log('Latest 20 Broadcast Notifications:');
        console.table(res.rows.map(r => ({
            id: r.id,
            user: r.user_name,
            role: r.role,
            title: r.title,
            type: r.type,
            created: r.created_at,
            is_read: r.is_read
        })));

        const counts = await pool.query(`
            SELECT type, count(*) 
            FROM notifications 
            GROUP BY type
        `);
        console.log('\nNotification counts by type:');
        console.table(counts.rows);

        await pool.end();
    } catch (err) {
        console.error('CRITICAL Error:', err.message);
        process.exit(1);
    }
}

checkBroadcasts();
