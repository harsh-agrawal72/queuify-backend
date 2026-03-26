const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    ssl: {
        rejectUnauthorized: false
    }
});

const checkSettings = async () => {
    try {
        console.log('--- DB Notification Settings Check ---');
        
        const orgRes = await pool.query('SELECT id, name, contact_email, email_notification, new_booking_notification FROM organizations;');
        console.log('\nOrganizations:');
        console.log(JSON.stringify(orgRes.rows, null, 2));

        const userRes = await pool.query('SELECT id, name, email, email_notification_enabled FROM users LIMIT 10;');
        console.log('\nUsers (first 10):');
        console.log(JSON.stringify(userRes.rows, null, 2));

        await pool.end();
    } catch (error) {
        console.error('Check failed:', error.message);
        await pool.end();
    }
};

checkSettings();
