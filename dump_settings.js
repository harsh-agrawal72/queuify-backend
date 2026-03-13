const { pool } = require('./src/config/db');

async function dumpOrgSettings() {
    try {
        const res = await pool.query('SELECT name, email_notification, new_booking_notification, contact_email FROM organizations');
        console.log('--- Organization Notification Settings ---');
        console.log(JSON.stringify(res.rows, null, 2));

        const userRes = await pool.query("SELECT name, email, role, email_notification_enabled FROM users WHERE role IN ('admin', 'superadmin')");
        console.log('\n--- Admin Notification Settings ---');
        console.log(JSON.stringify(userRes.rows, null, 2));

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

dumpOrgSettings();
