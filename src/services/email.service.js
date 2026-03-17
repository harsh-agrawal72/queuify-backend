const Mailjet = require('node-mailjet');
const config = require('../config/config');

const VERSION_TAG = "[EMAIL-SERVICE]";
console.log(`${VERSION_TAG} Initializing Mailjet...`);

let mailjet;
if (config.email.mailjet.apiKey && config.email.mailjet.apiSecret) {
    mailjet = Mailjet.apiConnect(
        config.email.mailjet.apiKey,
        config.email.mailjet.apiSecret
    );
    console.log(`${VERSION_TAG} Mailjet API Keys Set`);
} else {
    console.warn(`${VERSION_TAG} Mailjet API Keys Missing!`);
}

const sendEmail = async (to, subject, html) => {
    try {
        if (!mailjet) throw new Error("Mailjet not initialized");
        console.log(`${VERSION_TAG} Sending email to: ${to}`);

        const result = await mailjet
            .post("send", { version: 'v3.1' })
            .request({
                Messages: [
                    {
                        From: {
                            Email: config.email.from,
                            Name: "Queuify Manager"
                        },
                        To: [
                            {
                                Email: to
                            }
                        ],
                        Subject: subject,
                        HTMLPart: html
                    }
                ]
            });

        const message = result.body.Messages[0];
        console.log(`${VERSION_TAG} Mailjet Delivery Status: ${message.Status} | MessageID: ${message.To[0].MessageID}`);
        return result;
    } catch (error) {
        console.error(`${VERSION_TAG} Email Error for ${to}:`, error.message);
        throw error;
    }
};

module.exports = {
    sendEmail,
    sendBookingConfirmation: async (to, appointment) => {
        const subject = 'Appointment Confirmation';
        const userName = appointment.user_name || appointment.userName || 'there';
        const orgName = appointment.org_name || appointment.orgName || 'Organization';
        const serviceName = appointment.service_name || appointment.serviceName || 'Service';
        const tokenNumber = appointment.token_number || appointment.tokenNumber || 'N/A';
        const startTime = appointment.start_time || appointment.startTime;

        const html = `
            <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; color: #1e293b;">
                <h2 style="color:#4f46e5; margin-top: 0;">Appointment Confirmed!</h2>
                <p>Hello ${userName}, Your appointment has been booked successfully.</p>
                <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 0; font-size: 14px; color: #64748b;">Token Number</p>
                    <p style="margin: 4px 0 0 0; font-size: 24px; font-weight: 700; color: #1e293b;">${tokenNumber}</p>
                </div>
                <div style="margin: 20px 0;">
                    <p><strong>Organization:</strong> ${orgName}</p>
                    <p><strong>Service:</strong> ${serviceName}</p>
                    <p><strong>Time:</strong> ${startTime ? new Date(startTime).toLocaleString() : 'N/A'}</p>
                </div>
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;">
                <p style="font-size: 12px; color: #94a3b8; text-align: center;">Queuify Manager Team</p>
            </div>
        `;
        await sendEmail(to, subject, html);
    },

    sendCancellationEmail: async (to, appointment) => {
        const subject = 'Appointment Cancelled';
        const serviceName = appointment.service_name || appointment.serviceName || 'Service';
        const orgName = appointment.org_name || appointment.orgName || 'Organization';
        const html = `
            <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
                <h2 style="color:#ef4444;">Appointment Cancelled</h2>
                <p>Your appointment for <strong>${serviceName}</strong> at <strong>${orgName}</strong> has been cancelled.</p>
                <p>If you have any questions, please contact the organization.</p>
            </div>
        `;
        await sendEmail(to, subject, html);
    },

    sendStatusUpdateEmail: async (to, appointment) => {
        const status = (appointment.status || '').toUpperCase();
        const orgName = appointment.org_name || appointment.orgName || 'Organization';
        const subject = `Appointment Status: ${status}`;
        const html = `
            <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
                <h2 style="color:#4f46e5;">Status Update</h2>
                <p>Your appointment status has been updated to: <strong>${status}</strong></p>
                <p>Organization: ${orgName}</p>
            </div>
        `;
        await sendEmail(to, subject, html);
    },

    sendReminderEmail: async (to, appointment) => {
        const subject = 'Reminder: Your Appointment is in 15 Minutes';
        const userName = appointment.userName || appointment.user_name || 'there';
        const orgName = appointment.orgName || appointment.org_name || 'Organization';
        const serviceName = appointment.serviceName || appointment.service_name || 'Service';

        const html = `
            <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; color: #1e293b;">
                <h2 style="color:#4f46e5; margin-top: 0;">Upcoming Appointment Reminder</h2>
                <p>Hello ${userName}, your appointment is scheduled to start in approximately 15 minutes.</p>
                <div style="background-color: #fefce8; border: 1px solid #fef08a; padding: 16px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 0; color: #854d0e;">Please arrive at the location on time.</p>
                </div>
                <div style="margin: 20px 0;">
                    <p><strong>Organization:</strong> ${orgName}</p>
                    <p><strong>Service:</strong> ${serviceName}</p>
                </div>
                <p style="font-size: 14px; color: #64748b;">Thank you for using Queuify.</p>
            </div>
        `;
        await sendEmail(to, subject, html);
    },

    sendAdminBookingNotification: async (to, appointment) => {
        const subject = `New Booking: ${appointment.token_number || appointment.tokenNumber || 'N/A'}`;
        const userName = appointment.user_name || appointment.userName || 'N/A';
        const serviceName = appointment.service_name || appointment.serviceName || 'N/A';
        const tokenNumber = appointment.token_number || appointment.tokenNumber || 'N/A';

        const html = `
            <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; color: #1e293b;">
                <h2 style="color:#4f46e5; margin-top: 0;">New Appointment Booking</h2>
                <p>A new appointment has been booked at your organization.</p>
                <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; margin: 20px 0;">
                    <p><strong>Customer:</strong> ${userName}</p>
                    <p><strong>Service:</strong> ${serviceName}</p>
                    <p><strong>Token:</strong> ${tokenNumber}</p>
                </div>
                <p style="font-size: 14px; color: #64748b;">You can manage this in your admin dashboard.</p>
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