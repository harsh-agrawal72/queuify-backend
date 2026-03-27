const { Resend } = require('resend');
const config = require('../config/config');

const VERSION_TAG = "[EMAIL-SERVICE]";
console.log(`${VERSION_TAG} Initializing Resend API Client...`);

const resend = new Resend(config.email.resend.apiKey || 're_placeholder');

/**
 * Premium Email Layout Wrapper
 */
const wrapInProfessionalLayout = (content, previewText = 'Your Queuify Appointment Update') => `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Queuify Notification</title>
        <style>
            body { font-family: 'Inter', system-ui, -apple-system, sans-serif; line-height: 1.6; color: #1e293b; margin: 0; padding: 0; background-color: #f1f5f9; }
            .preview-text { display: none; max-height: 0px; overflow: hidden; }
            .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); border: 1px solid #e2e8f0; }
            .header { background: #4f46e5; background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 48px 20px; text-align: center; color: white; }
            .header h1 { margin: 0; font-size: 32px; font-weight: 800; letter-spacing: -0.025em; text-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .content { padding: 48px; }
            .footer { padding: 32px; text-align: center; background: #f8fafc; color: #94a3b8; font-size: 14px; border-top: 1px solid #e2e8f0; }
            .button { display: inline-block; background: #4f46e5; color: #ffffff !important; padding: 16px 32px; border-radius: 16px; text-decoration: none; font-weight: 700; font-size: 16px; margin: 24px 0; transition: all 0.2s; box-shadow: 0 10px 15px -3px rgba(79, 70, 229, 0.3); }
            .info-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 20px; padding: 32px; margin: 24px 0; text-align: center; }
            .token-display { background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px; margin: 16px auto; display: inline-block; min-width: 140px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
            .token-number { font-size: 44px; font-weight: 900; color: #4f46e5; margin: 0; line-height: 1; letter-spacing: -0.02em; }
            .detail-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9; }
            .detail-label { color: #64748b; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
            .detail-value { color: #1e293b; font-weight: 600; text-align: right; }
        </style>
    </head>
    <body>
        <div class="preview-text">${previewText}</div>
        <div class="container">
            <div class="header">
                <h1>Queuify</h1>
            </div>
            <div class="content">
                ${content}
            </div>
            <div class="footer">
                <p>&copy; ${new Date().getFullYear()} Queuify Inc. Excellence in Attendance Management.</p>
                <p style="font-size: 12px;">This is an automated notification. Please do not reply directly to this email.</p>
            </div>
        </div>
    </body>
    </html>
`;

/**
 * Helper to format times consistently
 */
const formatTime = (time) => {
    if (!time) return 'N/A';
    try {
        return new Date(time).toLocaleString('en-IN', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Kolkata'
        });
    } catch (e) {
        return 'Invalid Date';
    }
};

/**
 * Core send mail function
 */
const sendEmail = async (to, subject, html) => {
    try {
        console.log(`${VERSION_TAG} Sending email via Resend API to: ${to}`);

        const { data, error } = await resend.emails.send({
            from: `Queuify Notification <support@queuify.in>`,
            to: [to],
            subject: subject,
            html: html,
        });

        if (error) {
            console.error(`${VERSION_TAG} Resend API Error for ${to}:`, error.name, error.message);
            throw error;
        }

        console.log(`${VERSION_TAG} Email sent successfully via Resend API. ID: ${data.id}`);
        return data;
    } catch (error) {
        console.error(`${VERSION_TAG} unexpected error for ${to}:`, error.message);
        throw error;
    }
};

module.exports = {
    sendEmail,

    /**
     * Confirmation sent to the User
     */
    sendBookingConfirmation: async (to, appointment) => {
        const subject = 'Appointment Confirmed! - Queuify';
        const userName = appointment.user_name || appointment.customer_name || 'Customer';
        const orgName = appointment.org_name || 'Organization';
        const serviceName = appointment.service_name || 'Service';
        const tokenNumber = appointment.token_number || appointment.tokenNumber || 'QUEUED';
        const startTime = appointment.start_time || appointment.startTime || appointment.preferred_date;

        const html = wrapInProfessionalLayout(`
            <h2 style="margin: 0; font-size: 24px; color: #0f172a;">Appointment Confirmed!</h2>
            <p style="color: #64748b; font-size: 16px;">Hello <strong>${userName}</strong>, your reservation at <strong>${orgName}</strong> has been secured.</p>
            
            <div class="info-card">
                <div class="detail-label" style="margin-bottom: 8px;">Your Queue Token</div>
                <div class="token-display">
                    <div class="token-number">#${tokenNumber}</div>
                </div>
            </div>

            <div style="background: white; border: 1px solid #f1f5f9; border-radius: 16px; padding: 8px 0;">
                <div style="padding: 12px 24px; border-bottom: 1px solid #f1f5f9;">
                    <span style="color: #64748b; font-size: 13px; font-weight: 700; text-transform: uppercase;">Service</span>
                    <div style="color: #1e293b; font-weight: 600; margin-top: 4px;">${serviceName}</div>
                </div>
                <div style="padding: 12px 24px; border-bottom: 1px solid #f1f5f9;">
                    <span style="color: #64748b; font-size: 13px; font-weight: 700; text-transform: uppercase;">Time & Date</span>
                    <div style="color: #1e293b; font-weight: 600; margin-top: 4px;">${formatTime(startTime)}</div>
                </div>
                <div style="padding: 12px 24px;">
                    <span style="color: #64748b; font-size: 13px; font-weight: 700; text-transform: uppercase;">Location</span>
                    <div style="color: #1e293b; font-weight: 600; margin-top: 4px;">${orgName} ${appointment.org_address ? `<br><small style="font-weight: normal; color: #64748b;">${appointment.org_address}</small>` : ''}</div>
                </div>
            </div>

            <div style="text-align: center; margin-top: 32px;">
                <a href="${config.clientUrl}/dashboard" class="button">View My Appointment</a>
            </div>
            
            <p style="text-align: center; font-size: 14px; color: #94a3b8; margin-top: 24px;">Please arrive 10 minutes prior to your scheduled time. Show this email at the reception if requested.</p>
        `, `Confirmed: #${tokenNumber} for ${serviceName} at ${orgName}`);
        await sendEmail(to, subject, html);
    },

    /**
     * Cancellation Notice
     */
    sendCancellationEmail: async (to, appointment) => {
        const subject = 'Cancellation Notice - Queuify';
        const serviceName = appointment.service_name || 'Service';
        const orgName = appointment.org_name || 'Organization';
        const reason = appointment.cancellation_reason || 'Schedule adjustment or administrative request.';
        
        const html = wrapInProfessionalLayout(`
            <h2 style="color:#ef4444; margin: 0; font-size: 24px;">Appointment Cancelled</h2>
            <p style="color: #64748b; font-size: 16px;">We regret to inform you that your appointment for <strong>${serviceName}</strong> at <strong>${orgName}</strong> has been cancelled.</p>
            
            <div style="background: #fef2f2; border: 1px solid #fee2e2; border-radius: 16px; padding: 24px; margin: 24px 0;">
                <p style="margin: 0; font-size: 12px; font-weight: 700; color: #991b1b; text-transform: uppercase; letter-spacing: 0.05em;">Reason for Cancellation</p>
                <p style="margin: 12px 0 0 0; color: #7f1d1d; font-size: 15px; line-height: 1.5;">"${reason}"</p>
            </div>

            <div style="text-align: center; margin-top: 32px;">
                <a href="${config.clientUrl}/dashboard" class="button" style="background: #ef4444; box-shadow: 0 10px 15px -3px rgba(239, 68, 68, 0.3);">Book New Appointment</a>
            </div>
        `, `Update: Appointment for ${serviceName} has been cancelled.`);
        await sendEmail(to, subject, html);
    },

    /**
     * Status Update (confirmed, pending, serving, completed)
     */
    sendStatusUpdateEmail: async (to, appointment) => {
        const status = (appointment.status || 'Updated').toUpperCase();
        const orgName = appointment.org_name || 'Organization';
        const serviceName = appointment.service_name || 'Service';
        const subject = `Update: ${status} - ${serviceName}`;
        
        const statusColors = {
            'SERVING': { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' },
            'COMPLETED': { bg: '#f0f9ff', text: '#075985', border: '#bae6fd' },
            'CONFIRMED': { bg: '#f5f3ff', text: '#5b21b6', border: '#ddd6fe' },
            'WAITLISTED': { bg: '#fffbeb', text: '#92400e', border: '#fef3c7' }
        };
        const color = statusColors[status] || { bg: '#f8fafc', text: '#475569', border: '#e2e8f0' };

        const html = wrapInProfessionalLayout(`
            <h2 style="margin: 0; font-size: 24px; color: #0f172a;">Status Update</h2>
            <p style="color: #64748b; font-size: 16px;">Hello, your appointment for <strong>${serviceName}</strong> at <strong>${orgName}</strong> has been updated.</p>
            
            <div style="text-align: center; margin: 32px 0;">
                <div style="background: ${color.bg}; color: ${color.text}; border: 1px solid ${color.border}; padding: 12px 24px; border-radius: 99px; display: inline-block; font-weight: 800; font-size: 14px; letter-spacing: 0.1em; text-transform: uppercase;">
                    ${status}
                </div>
            </div>

            ${status === 'SERVING' ? `
                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 16px; padding: 24px; text-align: center;">
                    <p style="margin: 0; color: #166534; font-weight: 700;">It's your turn!</p>
                    <p style="margin: 8px 0 0 0; color: #166534; font-size: 14px;">Please proceed to the designated counter immediately.</p>
                </div>
            ` : ''}

            <div style="text-align: center; margin-top: 32px;">
                <a href="${config.clientUrl}/dashboard" class="button">Track Real-time Status</a>
            </div>
        `, `Your appointment for ${serviceName} is now ${status}.`);
        await sendEmail(to, subject, html);
    },

    /**
     * Arrival Reminder (sent by cron/workers)
     */
    sendReminderEmail: async (to, appointment) => {
        const subject = 'Reminder: Your Appointment is Starting Soon';
        const userName = appointment.user_name || 'there';
        const orgName = appointment.org_name || 'Organization';
        const serviceName = appointment.service_name || 'Service';

        const html = wrapInProfessionalLayout(`
            <h2 style="margin: 0; font-size: 24px; color: #0f172a;">Arrival Reminder</h2>
            <p style="color: #64748b; font-size: 16px;">Hello ${userName}, this is a friendly reminder for your upcoming appointment.</p>
            
            <div style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 20px; padding: 32px; margin: 24px 0;">
                <p style="margin: 0; font-size: 13px; font-weight: 700; color: #92400e; text-transform: uppercase;">Starting In 15 Minutes</p>
                <div style="margin-top: 16px;">
                    <p style="margin: 0; color: #451a03; font-weight: 600; font-size: 18px;">${serviceName}</p>
                    <p style="margin: 4px 0 0 0; color: #92400e;">Location: <strong>${orgName}</strong></p>
                </div>
            </div>
            
            <div style="text-align: center;">
                <a href="${config.clientUrl}/dashboard" class="button" style="background: #d97706; box-shadow: 0 10px 15px -3px rgba(217, 119, 6, 0.3);">I'm On My Way</a>
            </div>
        `, `Reminder: ${serviceName} starts in 15 mins.`);
        await sendEmail(to, subject, html);
    },

    /**
     * Admin Notification of new booking
     */
    sendAdminBookingNotification: async (to, appointment) => {
        const tokenNumber = appointment.token_number || appointment.tokenNumber || 'N/A';
        const subject = `New Booking: #${tokenNumber} - ${appointment.service_name || 'Service'}`;
        const userName = appointment.user_name || appointment.customer_name || 'Wait-in Customer';
        const serviceName = appointment.service_name || 'Service';

        const html = wrapInProfessionalLayout(`
            <h2 style="margin: 0; font-size: 24px; color: #0f172a;">New Appointment Alert</h2>
            <p style="color: #64748b; font-size: 16px;">A new appointment has been scheduled at your organization.</p>
            
            <div class="info-card">
                <div class="detail-label">Assigned Token</div>
                <div class="token-display">
                    <div class="token-number">#${tokenNumber}</div>
                </div>
                <div style="margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 20px; text-align: left;">
                    <div class="detail-row">
                        <span class="detail-label">Customer</span>
                        <span class="detail-value">${userName}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Service</span>
                        <span class="detail-value">${serviceName}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Scheduled Time</span>
                        <span class="detail-value">${formatTime(appointment.start_time || appointment.startTime || appointment.preferred_date)}</span>
                    </div>
                </div>
            </div>

            <div style="text-align: center;">
                <a href="${config.clientUrl}/admin/appointments?search=${appointment.id}" class="button">Manage Booking</a>
            </div>
        `, `New Booking: #${tokenNumber} from ${userName}`);
        await sendEmail(to, subject, html);
    },

    /**
     * Verification emails
     */
    sendOrgVerificationEmail: async (to, token) => {
        const subject = 'Verify Your Organization Email';
        const verificationUrl = `${config.clientUrl}/verify-org-email?token=${token}`;
        const html = wrapInProfessionalLayout(`
            <h2 style="margin: 0; font-size: 24px; color: #0f172a;">Verify Your Email</h2>
            <p style="color: #64748b; font-size: 16px;">Welcome to Queuify! Please verify your email to unlock all features for your organization.</p>
            
            <div style="text-align: center; margin: 40px 0;">
                <a href="${verificationUrl}" class="button">Confirm Email Address</a>
            </div>
            
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; font-size: 13px; color: #64748b; word-break: break-all;">
                <strong>Trouble clicking?</strong> Copy this link: ${verificationUrl}
            </div>
        `, 'Action Required: Please verify your Queuify account.');
        await sendEmail(to, subject, html);
    },

    sendWelcomeEmail: async (to, name) => {
        const subject = 'Welcome to Queuify!';
        const html = wrapInProfessionalLayout(`
            <h2 style="margin: 0; font-size: 28px; color: #0f172a;">Welcome aboard, ${name}!</h2>
            <p style="color: #64748b; font-size: 18px;">We're excited to help you transform your waiting experience.</p>
            
            <div style="text-align: center; margin-top: 40px;">
                <a href="${config.clientUrl}/admin" class="button">Go to Admin Dashboard</a>
            </div>
        `, 'Welcome to the future of queue management.');
        await sendEmail(to, subject, html);
    },

    sendAdminInvitationEmail: async (to, name, inviteLink) => {
        const subject = 'Invite: Join your team on Queuify';
        const html = wrapInProfessionalLayout(`
            <h2 style="margin: 0; font-size: 24px; color: #0f172a;">You've been invited!</h2>
            <p style="color: #64748b; font-size: 16px;">Hello ${name || 'Admin'}, you have been added as an <strong>Administrator</strong> for your organization on Queuify.</p>
            
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 20px; padding: 32px; margin: 32px 0; text-align: center;">
                <p style="margin: 0 0 24px 0; color: #1e293b;">Click below to set your password and access your dashboard:</p>
                <a href="${inviteLink}" class="button" style="margin: 0;">Accept Invitation</a>
            </div>
        `, `You're invited to manage your organization on Queuify.`);
        await sendEmail(to, subject, html);
    },

    sendOrgCreationEmail: async (to, adminName, orgName, inviteLink) => {
        const subject = 'Welcome! Your organization is live';
        const html = wrapInProfessionalLayout(`
            <h2 style="margin: 0; font-size: 28px; color: #0f172a;">Congratulations!</h2>
            <p style="color: #64748b; font-size: 18px;">Your organization <strong>${orgName}</strong> is now live on Queuify.</p>
            
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 24px; padding: 40px; margin: 32px 0; text-align: center;">
                <p style="margin: 0 0 24px 0; color: #166534; font-weight: 600;">You're ready to start managing appointments.</p>
                <a href="${inviteLink}" class="button" style="background: #16a34a; box-shadow: 0 10px 15px -3px rgba(22, 163, 74, 0.3); margin: 0;">Complete Admin Setup</a>
            </div>
        `, `Welcome to Queuify! ${orgName} is now active.`);
        await sendEmail(to, subject, html);
    },

    sendForgotPasswordEmail: async (to, resetPasswordUrl) => {
        const subject = 'Reset Your Password - Queuify';
        const html = wrapInProfessionalLayout(`
            <h2 style="margin: 0; font-size: 24px; color: #0f172a;">Reset Your Password</h2>
            <p style="color: #64748b; font-size: 16px;">We received a request to reset your password. If you didn't request this, you can safely ignore this email.</p>
            
            <div style="text-align: center; margin: 40px 0;">
                <a href="${resetPasswordUrl}" class="button">Reset Password</a>
            </div>
        `, 'Security Update: Password reset request.');
        await sendEmail(to, subject, html);
    },

    sendReassignmentEmail: async (to, appointment, newSlot) => {
        const subject = 'Schedule Update: Appointment Reassigned';
        const serviceName = appointment.service_name || 'Service';
        const orgName = appointment.org_name || 'Organization';
        
        const html = wrapInProfessionalLayout(`
            <h2 style="color:#4f46e5; margin: 0; font-size: 24px;">Schedule Updated</h2>
            <p style="color: #64748b; font-size: 16px;">Due to a schedule adjustment at <strong>${orgName}</strong>, your appointment for <strong>${serviceName}</strong> has been reassigned.</p>
            
            <div class="info-card" style="border-left: 4px solid #4f46e5; text-align: left;">
                <div class="detail-label">New Time</div>
                <div style="font-size: 20px; font-weight: 700; color: #1e293b; margin: 8px 0;">${formatTime(newSlot.start_time)}</div>
                <div class="detail-label" style="margin-top: 16px;">Professional</div>
                <div style="font-size: 16px; font-weight: 600; color: #475569;">${newSlot.resource_name || 'Staff'}</div>
            </div>
            
            <div style="text-align: center;">
                <a href="${config.clientUrl}/dashboard" class="button">Confirm New Time</a>
            </div>
        `, 'Update: Your appointment has been rescheduled.');
        await sendEmail(to, subject, html);
    },

    sendWaitlistEmail: async (to, appointment) => {
        const subject = 'Urgent Status: Waitlisted';
        const serviceName = appointment.service_name || 'Service';
        const orgName = appointment.org_name || 'Organization';

        const html = wrapInProfessionalLayout(`
            <h2 style="color:#f59e0b; margin: 0; font-size: 24px;">Queue Update: Waitlisted</h2>
            <p style="color: #64748b; font-size: 16px;">Your appointment for <strong>${serviceName}</strong> at <strong>${orgName}</strong> has been moved to the waitlist.</p>
            
            <div style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 20px; padding: 32px; margin: 24px 0;">
                <p style="margin: 0; font-size: 13px; font-weight: 800; color: #9a3412; text-transform: uppercase;">Status: Urgent Waitlist</p>
                <p style="margin: 16px 0 0 0; color: #9a3412; line-height: 1.6;">Our team is working to fit you in as soon as possible. Since you marked this as <strong>Urgent</strong>, you are currently at the top of our priority list.</p>
            </div>
            
            <div style="text-align: center;">
                <a href="${config.clientUrl}/dashboard" class="button" style="background: #f59e0b; box-shadow: 0 10px 15px -3px rgba(245, 158, 11, 0.3);">Track Live Position</a>
            </div>
        `, 'Priority Alert: You have been moved to the urgent waitlist.');
        await sendEmail(to, subject, html);
    },

    sendRebalanceNotificationEmail: async (to, appointment, newSlot) => {
        const subject = 'Optimized: Your Schedule Update';
        const serviceName = appointment.service_name || 'Service';
        const orgName = appointment.org_name || 'Organization';

        const html = wrapInProfessionalLayout(`
            <h2 style="color:#4f46e5; margin: 0; font-size: 24px;">Schedule Optimization</h2>
            <p style="color: #64748b; font-size: 16px;">To ensure a smoother experience at <strong>${orgName}</strong>, we have optimized the schedule.</p>
            
            <div class="info-card" style="border-left: 4px solid #4f46e5; text-align: left;">
                <div class="detail-label">New Optimized Time</div>
                <div style="font-size: 20px; font-weight: 700; color: #1e293b; margin: 8px 0;">${formatTime(newSlot.start_time)}</div>
                <div class="detail-label" style="margin-top: 16px;">Token ID</div>
                <div style="font-size: 16px; font-weight: 600; color: #475569;">#${appointment.token_number}</div>
            </div>
            
            <div style="text-align: center;">
                <a href="${config.clientUrl}/dashboard" class="button">View Details</a>
            </div>
        `, 'Great news: We\'ve optimized your appointment time.');
        await sendEmail(to, subject, html);
    }
};