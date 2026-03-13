const { pool } = require('./src/config/db');

async function dumpAllUserSettings() {
    try {
        const userRes = await pool.query("SELECT name, email, role, email_notification_enabled FROM users");
        console.log('\n--- All User Notification Settings ---');
        console.log(JSON.stringify(userRes.rows, null, 2));

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

dumpAllUserSettings();
