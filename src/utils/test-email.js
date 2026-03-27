const { sendEmail } = require('../services/email.service');

async function testMailjet() {
    console.log('--- Mailjet API Test ---');
    try {
        const to = 'harshagrawal7274@gmail.com';
        const subject = 'Queuify Mailjet API Test';
        const html = `
            <h1>Mailjet API Test Successful</h1>
            <p>This email was sent via the <strong>Mailjet REST API</strong> to bypass SMTP port restrictions on Render.</p>
            <p>Time: ${new Date().toLocaleString()}</p>
        `;

        console.log(`Attempting to send test email to ${to}...`);
        const result = await sendEmail(to, subject, html);
        console.log('Success! Result:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Test Failed!');
        console.error('Check your MAILJET_API_KEY and MAILJET_API_SECRET in .env');
        console.error('Error:', error.message);
    }
}

testMailjet();
