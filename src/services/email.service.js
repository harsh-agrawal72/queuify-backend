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
        const html = `
            <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; color: #1e293b;">
                <h2 style="color:#4f46e5; margin-top: 0;">Appointment Confirmed!</h2>
                <p>Hello ${appointment.user_name || 'there'}, Your appointment has been booked successfully.</p>
                <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 0; font-size: 14px; color: #64748b;">Token Number</p>
                    <p style="margin: 4px 0 0 0; font-size: 24px; font-weight: 700; color: #1e293b;">${appointment.token_number || 'N/A'}</p>
                </div>
                <div style="margin: 20px 0;">
                    <p><strong>Organization:</strong> ${appointment.org_name}</p>
                    <p><strong>Service:</strong> ${appointment.service_name}</p>
                    <p><strong>Time:</strong> ${new Date(appointment.start_time).toLocaleString()}</p>
                </div>
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;">
                <p style="font-size: 12px; color: #94a3b8; text-align: center;">Queuify Manager Team</p>
            </div>
        `;
        await sendEmail(to, subject, html);
    },

    sendCancellationEmail: async (to, appointment) => {
        const subject = 'Appointment Cancelled';
        const html = `
            <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
                <h2 style="color:#ef4444;">Appointment Cancelled</h2>
                <p>Your appointment for <strong>${appointment.service_name}</strong> at <strong>${appointment.org_name}</strong> has been cancelled.</p>
                <p>If you have any questions, please contact the organization.</p>
            </div>
        `;
        await sendEmail(to, subject, html);
    },

    sendStatusUpdateEmail: async (to, appointment) => {
        const subject = `Appointment Status: ${appointment.status.toUpperCase()}`;
        const html = `
            <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
                <h2 style="color:#4f46e5;">Status Update</h2>
                <p>Your appointment status has been updated to: <strong>${appointment.status.toUpperCase()}</strong></p>
                <p>Organization: ${appointment.org_name}</p>
            </div>
        `;
        await sendEmail(to, subject, html);
    },

    sendReminderEmail: async (to, appointment) => {
        const subject = 'Reminder: Your Appointment is in 15 Minutes';
        const html = `
            <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; color: #1e293b;">
                <h2 style="color:#4f46e5; margin-top: 0;">Upcoming Appointment Reminder</h2>
                <p>Hello ${appointment.userName}, your appointment is scheduled to start in approximately 15 minutes.</p>
                <div style="background-color: #fefce8; border: 1px solid #fef08a; padding: 16px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 0; color: #854d0e;">Please arrive at the location on time.</p>
                </div>
                <div style="margin: 20px 0;">
                    <p><strong>Organization:</strong> ${appointment.orgName}</p>
                    <p><strong>Service:</strong> ${appointment.serviceName}</p>
                </div>
                <p style="font-size: 14px; color: #64748b;">Thank you for using Queuify.</p>
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