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

const wrapInProfessionalLayout = (content) => `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; margin: 0; padding: 0; background-color: #f8fafc; }
            .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); border: 1px solid #e2e8f0; }
            .header { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 40px 20px; text-align: center; color: white; }
            .header h1 { margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.025em; }
            .content { padding: 40px; }
            .footer { padding: 20px; text-align: center; background: #f1f5f9; color: #64748b; font-size: 13px; }
            .button { display: inline-block; background-color: #4f46e5; color: #ffffff !important; padding: 14px 28px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 16px; margin: 20px 0; transition: all 0.2s; box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.2); }
            .info-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 20px 0; }
            .token { font-size: 32px; font-weight: 800; color: #4f46e5; margin: 10px 0; letter-spacing: 2px; }
            .label { color: #64748b; font-size: 12px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Queuify Manager</h1>
            </div>
            <div class="content">
                ${content}
            </div>
            <div class="footer">
                &copy; ${new Date().getFullYear()} Queuify Manager Team. All rights reserved.
            </div>
        </div>
    </body>
    </html>
`;

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
        const subject = 'Appointment Confirmation - Queuify';
        const userName = appointment.user_name || appointment.userName || 'there';
        const orgName = appointment.org_name || appointment.orgName || 'Organization';
        const serviceName = appointment.service_name || appointment.serviceName || 'Service';
        const tokenNumber = appointment.token_number || appointment.tokenNumber || 'N/A';
        const startTime = appointment.start_time || appointment.startTime;

        const html = wrapInProfessionalLayout(`
            <h2 style="margin-top: 0;">Appointment Confirmed!</h2>
            <p>Hello <strong>${userName}</strong>, Your appointment has been booked successfully.</p>
            
            <div class="info-box">
                <div class="label">Token Number</div>
                <div class="token">${tokenNumber}</div>
            </div>

            <div style="margin: 20px 0;">
                <p><strong>Organization:</strong> ${orgName}</p>
                <p><strong>Service:</strong> ${serviceName}</p>
                <p><strong>Time:</strong> ${startTime ? new Date(startTime).toLocaleString() : 'N/A'}</p>
            </div>
            
            <p>Please arrive at least 5 minutes before your scheduled time.</p>
        `);
        await sendEmail(to, subject, html);
    },

    sendCancellationEmail: async (to, appointment) => {
        const subject = 'Appointment Cancelled - Queuify';
        const serviceName = appointment.service_name || appointment.serviceName || 'Service';
        const orgName = appointment.org_name || appointment.orgName || 'Organization';
        const html = wrapInProfessionalLayout(`
            <h2 style="color:#ef4444; margin-top: 0;">Appointment Cancelled</h2>
            <p>Your appointment for <strong>${serviceName}</strong> at <strong>${orgName}</strong> has been cancelled.</p>
            <div class="info-box" style="border-left: 4px solid #ef4444;">
                <p style="margin: 0; color: #7f1d1d;">If you have any questions or would like to reschedule, please contact the organization directly or visit the dashboard.</p>
            </div>
            <p>Thank you for your understanding.</p>
        `);
        await sendEmail(to, subject, html);
    },

    sendStatusUpdateEmail: async (to, appointment) => {
        const status = (appointment.status || '').toUpperCase();
        const orgName = appointment.org_name || appointment.orgName || 'Organization';
        const subject = `Update: ${status} - Appointment Status`;
        const html = wrapInProfessionalLayout(`
            <h2 style="margin-top: 0;">Status Update</h2>
            <p>Your appointment status at <strong>${orgName}</strong> has been updated to:</p>
            <div class="info-box" style="text-align: center;">
                <span style="background-color: #4f46e5; color: white; padding: 8px 16px; border-radius: 20px; font-weight: 700; text-transform: uppercase; font-size: 14px;">${status}</span>
            </div>
            <p>You can track your live position and status in the Queuify dashboard.</p>
        `);
        await sendEmail(to, subject, html);
    },

    sendReminderEmail: async (to, appointment) => {
        const subject = 'Reminder: Your Appointment is Starting Soon';
        const userName = appointment.userName || appointment.user_name || 'there';
        const orgName = appointment.orgName || appointment.org_name || 'Organization';
        const serviceName = appointment.serviceName || appointment.service_name || 'Service';

        const html = wrapInProfessionalLayout(`
            <h2 style="margin-top: 0;">Arrival Reminder</h2>
            <p>Hello ${userName}, this is a friendly reminder that your appointment for <strong>${serviceName}</strong> is scheduled to start in approximately 15 minutes.</p>
            <div class="info-box" style="background-color: #fffbeb; border: 1px solid #fef3c7;">
                <p style="margin: 0; color: #92400e; font-weight: 600;">Location: ${orgName}</p>
                <p style="margin: 5px 0 0 0; color: #b45309;">Please ensure you are at the location on time to maintain your position in the queue.</p>
            </div>
            <p>We look forward to serving you!</p>
        `);
        await sendEmail(to, subject, html);
    },

    sendAdminBookingNotification: async (to, appointment) => {
        const subject = `New Booking Alert - ${appointment.token_number || 'N/A'}`;
        const userName = appointment.user_name || appointment.userName || 'N/A';
        const serviceName = appointment.service_name || appointment.serviceName || 'N/A';
        const tokenNumber = appointment.token_number || appointment.tokenNumber || 'N/A';

        const html = wrapInProfessionalLayout(`
            <h2 style="margin-top: 0;">New Appointment Booked</h2>
            <p>A new appointment has been scheduled at your organization.</p>
            <div class="info-box">
                <p><strong>Customer:</strong> ${userName}</p>
                <p><strong>Service:</strong> ${serviceName}</p>
                <div class="label">Token Number</div>
                <div class="token" style="font-size: 24px;">${tokenNumber}</div>
            </div>
            <p>You can manage this booking in your admin dashboard.</p>
        `);
        await sendEmail(to, subject, html);
    },

    sendOrgVerificationEmail: async (to, token) => {
        const subject = 'Verify Your Organization Email';
        const verificationUrl = `${config.clientUrl}/verify-org-email?token=${token}`;
        const html = wrapInProfessionalLayout(`
            <h2 style="margin-top: 0;">Verify Your Email</h2>
            <p>Please click the button below to verify your organization's contact email address. This step is necessary to secure your account.</p>
            <div style="text-align: center; margin: 35px 0;">
                <a href="${verificationUrl}" class="button">Verify Email Address</a>
            </div>
            <p style="font-size: 14px; color: #64748b;">If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="font-size: 12px; color: #94a3b8; word-break: break-all;">${verificationUrl}</p>
            <p style="font-size: 14px; color: #64748b; margin-top: 25px;">This link will expire in 24 hours.</p>
        `);
        await sendEmail(to, subject, html);
    },
    
    sendWelcomeEmail: async (to, name) => {
        const subject = 'Welcome to Queuify!';
        const html = wrapInProfessionalLayout(`
            <h2 style="margin-top: 0;">Welcome, ${name}!</h2>
            <p>We're thrilled to have you with us. Queuify helps you manage appointments and queues with ease.</p>
            <div class="info-box">
                <p style="margin: 0; font-weight: 700; color: #1e293b;">Quick Start Guide:</p>
                <ul style="margin: 15px 0 0 0; padding-left: 20px; color: #475569;">
                    <li>Set up your organization profile</li>
                    <li>Add your services and staff</li>
                    <li>Configure your available slots</li>
                    <li>Start accepting bookings!</li>
                </ul>
            </div>
            <p>If you have any questions, just reply to this email. We're here to help!</p>
        `);
        await sendEmail(to, subject, html);
    },

    sendAdminInvitationEmail: async (to, name, inviteLink) => {
        const subject = 'Admin Invitation - Set Your Password';
        const html = wrapInProfessionalLayout(`
            <h2 style="margin-top: 0;">You're Invited!</h2>
            <p>Hello ${name || 'Admin'},</p>
            <p>You have been invited to join an organization as an <strong>Administrator</strong>.</p>
            <p>Please click the button below to set up your password and activate your account:</p>
            <div style="text-align: center; margin: 35px 0;">
                <a href="${inviteLink}" class="button">Set Password & Join</a>
            </div>
            <p style="font-size: 14px; color: #64748b;">Or copy this link: ${inviteLink}</p>
            <p style="margin-top: 25px;">Welcome to the team!</p>
        `);
        await sendEmail(to, subject, html);
    },

    sendOrgCreationEmail: async (to, adminName, orgName, inviteLink) => {
        const subject = 'Welcome! Your Organization is Ready';
        const html = wrapInProfessionalLayout(`
            <h2 style="margin-top: 0;">Welcome to Queuify!</h2>
            <p>Hello ${adminName},</p>
            <p>Your organization <strong>${orgName}</strong> has been successfully created. You can now manage your services, staff, and appointments.</p>
            <p>To get started, please set up your admin password using the button below:</p>
            <div style="text-align: center; margin: 35px 0;">
                <a href="${inviteLink}" class="button">Setup Admin Account</a>
            </div>
            <p style="font-size: 14px; color: #64748b;">This link will expire in 7 days.</p>
            <p style="margin-top: 25px;">We look forward to helping you grow!</p>
        `);
        await sendEmail(to, subject, html);
    },

    sendForgotPasswordEmail: async (to, resetPasswordUrl) => {
        const subject = 'Reset Your Password - Queuify';
        const html = wrapInProfessionalLayout(`
            <h2 style="margin-top: 0;">Reset Password</h2>
            <p>We received a request to reset your password. If you didn't make this request, you can safely ignore this email.</p>
            <p>To reset your password, please click the button below:</p>
            <div style="text-align: center; margin: 35px 0;">
                <a href="${resetPasswordUrl}" class="button">Reset Password</a>
            </div>
            <p style="font-size: 14px; color: #64748b;">This link will expire in 1 hour.</p>
            <p style="margin-top: 25px;">Stay secure!</p>
        `);
        await sendEmail(to, subject, html);
    },

    sendContactFormEmail: async (adminEmail, contactData) => {
        const { name, email, subject, message } = contactData;
        const emailSubject = `Contact Form: ${subject}`;
        const html = wrapInProfessionalLayout(`
            <h2 style="margin-top: 0;">New Contact Message</h2>
            <p>You have a new submission from your website's contact form.</p>
            <div class="info-box">
                <p><strong>From:</strong> ${name} (<a href="mailto:${email}">${email}</a>)</p>
                <p><strong>Subject:</strong> ${subject}</p>
                <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e2e8f0;">
                    <p style="margin:0; font-weight: 700;">Message:</p>
                    <p style="white-space: pre-wrap; margin-top: 5px;">${message}</p>
                </div>
            </div>
            <p style="font-size: 12px; color: #64748b;">This message was generated from the Queuify contact form.</p>
        `);
        await sendEmail(adminEmail, emailSubject, html);
    }
};