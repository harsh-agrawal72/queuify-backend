require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const nodemailer = require('nodemailer');

const testSMTP = async () => {
    console.log('--- SMTP Diagnostic Test (Port 587) ---');
    const config = {
        host: process.env.SMTP_HOST,
        port: 587,
        secure: false, // TLS
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
        family: 4,
        connectionTimeout: 10000,
    };
    
    console.log('Config:', { ...config, auth: { ...config.auth, pass: '****' } });

    const transporter = nodemailer.createTransport(config);

    try {
        console.log('Verifying connection...');
        await transporter.verify();
        console.log('SUCCESS: SMTP connection verified on 587!');
    } catch (err) {
        console.error('FAILED on 587:', err.message);
    }
};

testSMTP();
