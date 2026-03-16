const nodemailer = require('nodemailer');
const config = require('../config/config');
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const VERSION_TAG = "[EMAIL-SERVICE]";
console.log(`${VERSION_TAG} Initializing...`);

// Clean and stable transporter
const transporter = nodemailer.createTransport({
    host: config.email.smtp.host,
    port: config.email.smtp.port,
    secure: config.email.smtp.port === 465, // true for 465, false for other ports
    auth: {
        user: config.email.smtp.auth.user,
        pass: config.email.smtp.auth.pass,
    },
    tls: {
        servername: config.email.smtp.host // Ensures SSL certificate matches the hostname
    },
    connectionTimeout: 60000,
    greetingTimeout: 30000,
    socketTimeout: 60000
});

// Verify connection
transporter.verify((error, success) => {
    if (error) {
        console.error(`${VERSION_TAG} Verify Failed:`, error.message);
    } else {
        console.log(`${VERSION_TAG} SMTP Server Ready`);
    }
});

const sendEmail = async (to, subject, html) => {
    try {
        console.log(`${VERSION_TAG} Sending email to: ${to}`);

        const msg = {
            from: `"Queuify Manager" <${config.email.from}>`,
            to,
            subject,
            html
        };

        const info = await transporter.sendMail(msg);

        console.log(`${VERSION_TAG} Email Sent: ${info.messageId}`);
    } catch (error) {
        console.error(`${VERSION_TAG} Email Error for ${to}:`, error.message);
        if (error.code) console.error(`${VERSION_TAG} SMTP Code: ${error.code}`);
    }
};

module.exports = {
    transport: transporter,
    sendEmail,

    sendBookingConfirmation: async (to, appointment) => {
        const subject = `Booking Confirmed - Token: ${appointment.token_number}`;
        const html = `
            <div style="font-family: Arial; max-width:600px; margin:auto">
                <h2 style="color:#10b981;">Booking Confirmed</h2>
                <p>Your appointment has been booked at <b>${appointment.org_name}</b>.</p>
                <p><b>Token:</b> ${appointment.token_number}</p>
                <p><b>Date:</b> ${new Date(appointment.slot_start_time).toLocaleString()}</p>
            </div>
        `;
        await sendEmail(to, subject, html);
    },

    sendCancellationEmail: async (to, appointment) => {
        const subject = `Appointment Cancelled - ${appointment.token_number || appointment.id}`;
        const html = `
            <div style="font-family: Arial; max-width:600px; margin:auto">
                <h2 style="color:#ef4444;">Appointment Cancelled</h2>
                <p>Token <b>${appointment.token_number || 'N/A'}</b> has been cancelled.</p>
                <p>Service: ${appointment.service_name || 'N/A'}</p>
                <p>Organization: ${appointment.org_name || 'N/A'}</p>
            </div>
        `;
        await sendEmail(to, subject, html);
    },

    sendReminderEmail: async (to, data) => {
        const subject = `Reminder: Appointment at ${data.orgName}`;
        const html = `
            <div style="font-family: Arial; max-width:600px; margin:auto">
                <h2 style="color:#4f46e5;">Appointment Reminder</h2>
                <p>Hi ${data.userName || 'there'},</p>
                <p>Your appointment is in 15 minutes.</p>
                <p><b>Service:</b> ${data.serviceName}</p>
                <p><b>Organization:</b> ${data.orgName}</p>
                <p><b>Time:</b> ${new Date(data.startTime).toLocaleTimeString()}</p>
            </div>
        `;
        await sendEmail(to, subject, html);
    },

    sendStatusUpdateEmail: async (to, appointment) => {
        const subject = `Appointment Status Updated: ${appointment.status}`;
        const html = `
            <div style="font-family: Arial; max-width:600px; margin:auto">
                <h2>Status Updated: ${appointment.status}</h2>
                <p>Service: ${appointment.service_name}</p>
                <p>Organization: ${appointment.org_name}</p>
                <p>Token: ${appointment.token_number}</p>
            </div>
        `;
        await sendEmail(to, subject, html);
    }
};