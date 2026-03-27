require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const nodemailer = require('nodemailer');

const testSMTP = async () => {
    console.log('--- SMTP Direct IPv4 Diagnostic ---');
    // Using the IP resolved by nslookup: 172.65.255.143
    const directIp = '172.65.255.143'; 
    const originalHost = 'smtp.hostinger.com';

    const config = {
        host: directIp,
        port: 587,
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
        tls: {
            servername: originalHost, // CRITICAL: This is needed for certificate verification
            rejectUnauthorized: true
        },
        connectionTimeout: 10000,
    };
    
    console.log('Config using Direct IP:', directIp);

    const transporter = nodemailer.createTransport(config);

    try {
        console.log('Verifying connection to IP...');
        await transporter.verify();
        console.log('SUCCESS: Connection verified using direct IPv4!');
        
        console.log('Sending test mail...');
        await transporter.sendMail({
            from: process.env.EMAIL_FROM,
            to: process.env.SMTP_USER,
            subject: 'Direct IPv4 Test',
            text: 'This test bypasses DNS and connects directly via IPv172.65.255.143'
        });
        console.log('SUCCESS: Email sent via direct IP!');
    } catch (err) {
        console.error('FAILED:', err.message);
    }
};

testSMTP();
