const { pool } = require('./src/config/db');
const nodemailer = require('nodemailer');
const config = require('./src/config/config');

async function runDiagnostics() {
    console.log("=== DIAGNOSTICS ===");

    // Check SMTP
    const transporter = nodemailer.createTransport({
        host: config.email.smtp.host,
        port: config.email.smtp.port,
        auth: config.email.smtp.auth
    });
    try {
        await transporter.verify();
        console.log("SMTP: OK");
    } catch (err) {
        console.log("SMTP: FAIL - " + err.message);
    }

    // Check Orgs
    const orgs = await pool.query('SELECT name, email_notification, new_booking_notification FROM organizations');
    console.log("Orgs Found: " + orgs.rows.length);
    orgs.rows.forEach(o => {
        console.log(`Org: ${o.name} | EmailNotify: ${o.email_notification} | NewBookingNotify: ${o.new_booking_notification}`);
    });

    // Check Notifs
    const notifs = await pool.query('SELECT count(*) FROM notifications');
    console.log("Total Notifs: " + notifs.rows[0].count);

    process.exit(0);
}

runDiagnostics();
