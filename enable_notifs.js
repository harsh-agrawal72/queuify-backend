const { pool } = require('./src/config/db');

async function enableAll() {
    try {
        console.log("Enabling notifications for all organizations...");
        const res = await pool.query('UPDATE organizations SET email_notification = true, new_booking_notification = true');
        console.log(`Updated ${res.rowCount} organizations.`);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

enableAll();
