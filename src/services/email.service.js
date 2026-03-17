const sgMail = require('@sendgrid/mail');
const config = require('../config/config');

const VERSION_TAG = "[EMAIL-SERVICE]";
console.log(`${VERSION_TAG} Initializing SendGrid...`);

if (config.email.sendgridApiKey) {
    sgMail.setApiKey(config.email.sendgridApiKey);
    console.log(`${VERSION_TAG} SendGrid API Key Set`);
} else {
    console.warn(`${VERSION_TAG} SendGrid API Key Missing!`);
}

// Minimal verification - SendGrid doesn't have a direct "verify" like Nodemailer,
// but we can check if the API key is provided.
const verifyConnection = () => {
    if (!config.email.sendgridApiKey) {
        console.error(`${VERSION_TAG} SendGrid Configuration Failed: API Key is missing.`);
        return false;
    }
    return true;
};
verifyConnection();

const sendEmail = async (to, subject, html) => {
    try {
        console.log(`${VERSION_TAG} Sending email to: ${to}`);

        const msg = {
            from: config.email.from, // Must be verified in SendGrid
            to,
            subject,
            html
        };

        const result = await sgMail.send(msg);

        console.log(`${VERSION_TAG} Email Sent successfully via SendGrid`);
        return result;
    } catch (error) {
        console.error(`${VERSION_TAG} Email Error for ${to}:`, error.message);
        if (error.response) {
            console.error(`${VERSION_TAG} SendGrid Response Error:`, error.response.body);
        }
    }
};

module.exports = {
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
    },
    
    sendWelcomeEmail: async (to, name) => {
        const subject = 'Welcome to Queuify!';
        const html = `
            <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; color: #1e293b;">
                <h2 style="color:#4f46e5; margin-top: 0;">Welcome to Queuify, ${name}!</h2>
                <p>We're thrilled to have you with us. Queuify helps you manage appointments and queues with ease.</p>
                <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 0; font-weight: 600;">Explore your dashboard:</p>
                    <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #475569;">
                        <li>Book or manage appointments</li>
                        <li>Real-time queue tracking</li>
                        <li>Automated notifications</li>
                    </ul>
                </div>
                <p>If you have any questions, just reply to this email. We're here to help!</p>
                <p style="margin-bottom: 0;">Best regards,<br>The Queuify Team</p>
            </div>
        `;
        await sendEmail(to, subject, html);
    }
};