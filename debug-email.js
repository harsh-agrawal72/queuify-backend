require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const nodemailer = require('nodemailer');

const testSMTP = async () => {
    console.log('--- SMTP Diagnostic Test ---');
    const config = {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT),
        secure: parseInt(process.env.SMTP_PORT) === 465,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
        family: 4, // Force IPv4
        connectionTimeout: 10000,
    };
    
    console.log('Config:', { ...config, auth: { ...config.auth, pass: '****' } });

    const transporter = nodemailer.createTransport(config);

    try {
        console.log('Verifying connection...');
        await transporter.verify();
        console.log('SUCCESS: SMTP connection verified!');
        
        console.log('Sending test email...');
        const info = await transporter.sendMail({
            from: process.env.EMAIL_FROM,
            to: process.env.SMTP_USER, // Send to self
            subject: 'SMTP Diagnostic Success',
            text: 'Connection and sending verified with family: 4',
        });
        console.log('SUCCESS: Email sent!', info.messageId);
    } catch (err) {
        console.error('FAILED:', err.message);
        if (err.code === 'ENETUNREACH') {
            console.error('Network unreachable. This often happens if the port is blocked or IPv6 is causing issues.');
        }
    }
};

testSMTP();
