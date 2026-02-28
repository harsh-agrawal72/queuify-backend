const nodemailer = require('nodemailer');
const config = require('../config/config');

// Create transporter
const transporter = nodemailer.createTransport({
    host: config.email.smtp.host,
    port: config.email.smtp.port,
    auth: {
        user: config.email.smtp.auth.user,
        pass: config.email.smtp.auth.pass,
    },
});

// Verify connection
transporter.verify(function (error, success) {
    if (error) {
        console.error('Email Service Error:', error);
    } else {
        console.log('Email Service is ready to send messages');
    }
});

const sendEmail = async (to, subject, html) => {
    try {
        const msg = {
            from: `"Queuify Manager" <${config.email.from}>`,
            to,
            subject,
            html,
        };
        await transporter.sendMail(msg);
        console.log(`Email sent to ${to}`);
    } catch (error) {
        console.error('Error sending email:', error);
    }
};

module.exports = {
    transport: transporter,
    sendEmail,
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
