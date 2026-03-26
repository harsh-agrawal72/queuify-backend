require('dotenv').config();
const nodemailer = require('nodemailer');

const testSMTP = async () => {
    console.log('--- SMTP Connection Test ---');
    console.log('Host:', process.env.SMTP_HOST || 'Missing');
    console.log('Port:', process.env.SMTP_PORT || 'Missing');
    console.log('User:', process.env.SMTP_USER || 'Missing');
    console.log('From Email:', process.env.EMAIL_FROM || 'Missing');
    
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.error('FAILED: SMTP credentials are missing in .env');
        return;
    }

    try {
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT),
            secure: parseInt(process.env.SMTP_PORT) === 465, // true for 465
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });

        console.log('Verifying SMTP connection...');
        await transporter.verify();
        console.log('SUCCESS: Connected to SMTP server!');

        console.log(`Sending test email to ${process.env.EMAIL_FROM} ...`);
        
        const result = await transporter.sendMail({
            from: process.env.EMAIL_FROM,
            to: process.env.EMAIL_FROM,
            subject: 'SMTP Success Test',
            text: 'If you see this, your SMTP configuration is working perfectly!',
        });

        console.log('SUCCESS: Test email sent via SMTP! MessageID:', result.messageId);
    } catch (error) {
        console.error('FAILED: SMTP test failed.');
        console.error('Error:', error.message);
        
        if (error.message.includes('getaddrinfo')) {
            console.error('ADVICE: Could not find the host. Your SMTP_HOST is incorrect.');
        } else if (error.message.includes('timeout') || error.message.includes('timeout')) {
            console.error('ADVICE: Connection timed out. Ensure the SMTP_PORT is correct and not blocked.');
        }
    }
};

testSMTP();
