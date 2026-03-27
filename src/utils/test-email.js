const { sendEmail } = require('../services/email.service');

async function testResend() {
    console.log('--- Resend API Test ---');
    try {
        const to = 'harshagrawal93557@gmail.com';
        const subject = 'Queuify Resend API Test';
        const html = `
            <h1>Resend API Test Successful</h1>
            <p>This email was sent via the <strong>Resend REST API</strong> to bypass SMTP port restrictions on Render.</p>
            <p>Time: ${new Date().toLocaleString()}</p>
        `;

        console.log(`Attempting to send test email to ${to}...`);
        const result = await sendEmail(to, subject, html);
        console.log('Success! Result:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Test Failed!');
        console.error('Check your RESEND_API_KEY in .env');
        console.error('Error:', error.message);
    }
}

testResend();
