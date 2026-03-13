const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const config = {
    email: {
        smtp: {
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            auth: {
                user: process.env.SMTP_USERNAME,
                pass: process.env.SMTP_PASSWORD,
            },
        },
        from: process.env.EMAIL_FROM,
    }
};

async function testEmail() {
    console.log('Testing Email Configuration...');
    console.log('Host:', config.email.smtp.host);
    console.log('Port:', config.email.smtp.port);
    console.log('From:', config.email.from);
    console.log('User:', config.email.smtp.auth.user);

    const transporter = nodemailer.createTransport({
        host: config.email.smtp.host,
        port: config.email.smtp.port,
        auth: {
            user: config.email.smtp.auth.user,
            pass: config.email.smtp.auth.pass,
        },
    });

    try {
        console.log('Verifying connection...');
        await transporter.verify();
        console.log('Connection verified successfully!');

        const info = await transporter.sendMail({
            from: `"Queuify Test" <${config.email.from}>`,
            to: config.email.from, // Send to self as test
            subject: 'Test Email from Queuify',
            text: 'This is a test email to verify SMTP configuration.',
            html: '<b>This is a test email to verify SMTP configuration.</b>',
        });

        console.log('Email sent successfully!');
        console.log('Message ID:', info.messageId);
    } catch (error) {
        console.error('Email Test Failed:');
        console.error(error);
    }
}

testEmail();
