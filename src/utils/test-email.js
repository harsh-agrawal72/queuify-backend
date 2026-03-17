require('dotenv').config();
const nodemailer = require('nodemailer');

const testEmail = async () => {
    console.log('--- SMTP Connection Test ---');
    console.log('Host:', process.env.SMTP_HOST);
    console.log('Port:', process.env.SMTP_PORT);
    console.log('User:', process.env.SMTP_USERNAME);
    
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: Number(process.env.SMTP_PORT) === 465,
        family: 4, // Force IPv4
        auth: {
            user: process.env.SMTP_USERNAME,
            pass: process.env.SMTP_PASSWORD,
        },
        connectionTimeout: 10000,
    });

    try {
        console.log('Verifying connection...');
        await transporter.verify();
        console.log('SUCCESS: SMTP server is ready to take our messages!');
        
        console.log('Sending test email to', process.env.EMAIL_FROM, '...');
        await transporter.sendMail({
            from: process.env.EMAIL_FROM,
            to: process.env.SMTP_USERNAME,
            subject: 'SMTP Success Test',
            text: 'If you see this, your SMTP configuration on Render is working perfectly!',
        });
        console.log('SUCCESS: Test email sent!');
    } catch (error) {
        console.error('FAILED: SMTP test failed.');
        console.error('Error Message:', error.message);
        console.error('Error Code:', error.code);
        if (error.code === 'ETIMEDOUT') {
            console.error('ADVICE: This is a timeout. Render is likely blocking outbound SMTP ports.');
        } else if (error.code === 'ENETUNREACH') {
            console.error('ADVICE: Network unreachable. This often happens with IPv6 issues.');
        }
    }
};

testEmail();
