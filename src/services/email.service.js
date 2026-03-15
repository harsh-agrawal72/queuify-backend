const nodemailer = require('nodemailer');
const dns = require('dns');
const config = require('../config/config');

const VERSION_TAG = "[v4-NUCLEAR]";
console.log(`${VERSION_TAG} EmailService Initializing...`);

// We want to force IPv4 so aggressively that we resolve it ourselves
// and pass the IP directly to Nodemailer.
let smtpHost = config.email.smtp.host;
let resolvedIp = smtpHost;

try {
    // DNS resolution is async, but we want to initialize the transporter.
    // We'll update the transporter if resolution finishes, or just use a custom lookup.
} catch (e) {}

const transporter = nodemailer.createTransport({
    // If it's a known host like gmail, we can be extra sure.
    // We'll use the hostname but force the node network layer to ONLY use IPv4.
    host: smtpHost,
    port: config.email.smtp.port,
    secure: config.email.smtp.port == 465,
    auth: {
        user: config.email.smtp.auth.user,
        pass: config.email.smtp.auth.pass,
    },
    tls: {
        rejectUnauthorized: false,
        servername: smtpHost // Required when forcing IPs or custom lookups
    },
    pool: true,
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
    // THE NUCLEAR SETTINGS
    family: 4, 
    localAddress: '0.0.0.0', // FORCE local bond to IPv4 address 0.0.0.0 (any)
    lookup: (hostname, options, callback) => {
        console.log(`${VERSION_TAG} DNS Lookup: ${hostname}`);
        dns.lookup(hostname, { family: 4 }, (err, address, family) => {
            if (err) {
                console.error(`${VERSION_TAG} DNS Error: ${err.message}`);
                return callback(err);
            }
            console.log(`${VERSION_TAG} DNS Success: ${address}`);
            callback(null, address, 4);
        });
    }
});

// Verify connection
transporter.verify(function (error, success) {
    if (error) {
        console.error(`${VERSION_TAG} Verify Failed:`, error.message);
        if (error.address) console.error(`${VERSION_TAG} Failed Address: ${error.address}`);
    } else {
        console.log(`${VERSION_TAG} Verify Success: Service Ready`);
    }
});

const sendEmail = async (to, subject, html) => {
    try {
        console.log(`${VERSION_TAG} Sending Email to: ${to}`);
        const msg = {
            from: `"Queuify Manager" <${config.email.from}>`,
            to,
            subject,
            html,
        };
        const info = await transporter.sendMail(msg);
        console.log(`${VERSION_TAG} SUCCESS: ${info.messageId}`);
    } catch (error) {
        console.error(`${VERSION_TAG} ERROR for ${to}:`, error.message);
        if (error.code) console.error(`${VERSION_TAG} SMTP Code: ${error.code}`);
        if (error.address) console.error(`${VERSION_TAG} Failed Address: ${error.address}`);
    }
};

module.exports = {
    transport: transporter,
    sendEmail,
    // ... rest of the file remains same, keeping the exports
    sendBookingConfirmation: async (to, appointment) => {
        const subject = `Booking Confirmed - Token: ${appointment.token_number}`;
        const html = `
            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; padding: 20px;">
                <h2 style="color: #10b981;">Booking Confirmed!</h2>
                <p>Your appointment has been successfully booked at <strong>${appointment.org_name}</strong>.</p>
                <div style="background: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 5px 0;"><strong>Token Number:</strong> <span style="font-size: 18px; font-weight: bold; color: #4f46e5;">${appointment.token_number}</span></p>
                    <p style="margin: 5px 0;"><strong>Date & Time:</strong> ${new Date(appointment.slot_start_time).toLocaleString()}</p>
                </div>
                <p>Thank you for choosing us.</p>
                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
                <p style="font-size: 12px; color: #999;">You can view your ticket and live queue status in your dashboard.</p>
            </div>
        `;
        await sendEmail(to, subject, html);
    },
    sendCancellationEmail: async (to, appointment) => {
        const subject = `Appointment Cancelled - ${appointment.token_number || appointment.id}`;
        const html = `
            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; padding: 20px;">
                <h2 style="color: #ef4444;">Appointment Cancelled</h2>
                <p>The appointment with Token <strong>${appointment.token_number || 'N/A'}</strong> has been cancelled.</p>
                <div style="background: #fef2f2; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 5px 0;"><strong>Service:</strong> ${appointment.service_name || 'N/A'}</p>
                    <p style="margin: 5px 0;"><strong>Organization:</strong> ${appointment.org_name || 'N/A'}</p>
                </div>
                <p>If this was not intended, please contact support or book a new slot.</p>
                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
            </div>
        `;
        await sendEmail(to, subject, html);
    },
    sendReminderEmail: async (to, data) => {
        const subject = `Reminder: Upcoming Appointment at ${data.orgName}`;
        const html = `
            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; padding: 20px;">
                <h2 style="color: #4f46e5;">Appointment Reminder</h2>
                <p>Hi ${data.userName || 'there'},</p>
                <p>This is a friendly reminder that you have an upcoming appointment in 15 minutes.</p>
                <div style="background: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 5px 0;"><strong>Service:</strong> ${data.serviceName}</p>
                    <p style="margin: 5px 0;"><strong>Organization:</strong> ${data.orgName}</p>
                    <p style="margin: 5px 0;"><strong>Time:</strong> ${new Date(data.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <p>Please arrive on time. We look forward to seeing you!</p>
                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
                <p style="font-size: 12px; color: #999;">If you cannot make it, please cancel your appointment through the dashboard.</p>
            </div>
        `;
        await sendEmail(to, subject, html);
    },
    sendStatusUpdateEmail: async (to, appointment) => {
        const subject = `Appointment Status Updated: ${appointment.status}`;
        const statusColors = {
            'confirmed': '#10b981',
            'completed': '#3b82f6',
            'cancelled': '#ef4444',
            'pending': '#f59e0b',
            'waiting': '#8b5cf6'
        };
        const color = statusColors[appointment.status.toLowerCase()] || '#4f46e5';

        const html = `
            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; padding: 20px;">
                <h2 style="color: ${color};">Status Updated: ${appointment.status.toUpperCase()}</h2>
                <p>Your appointment for <strong>${appointment.service_name || 'your service'}</strong> at <strong>${appointment.org_name || 'the organization'}</strong> has been updated.</p>
                <div style="background: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 5px 0;"><strong>New Status:</strong> <span style="font-weight: bold; color: ${color};">${appointment.status}</span></p>
                    <p style="margin: 5px 0;"><strong>Token:</strong> ${appointment.token_number || 'N/A'}</p>
                </div>
                <p>Thank you for your patience.</p>
                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
                <p style="font-size: 12px; color: #999;">You can track your live queue status in the user dashboard.</p>
            </div>
        `;
        await sendEmail(to, subject, html);
    }
};
