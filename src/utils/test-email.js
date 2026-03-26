require('dotenv').config();
const Mailjet = require('node-mailjet');

const testMailjet = async () => {
    console.log('--- Mailjet API Test ---');
    console.log('API Key:', process.env.MAILJET_API_KEY ? 'Set' : 'Missing');
    console.log('Secret Key:', process.env.MAILJET_SECRET_KEY ? 'Set' : 'Missing');
    console.log('From Email:', process.env.EMAIL_FROM || 'Missing');
    
    if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
        console.error('FAILED: Mailjet API Keys are missing in .env');
        return;
    }

    try {
        const mailjet = Mailjet.apiConnect(
            process.env.MAILJET_API_KEY,
            process.env.MAILJET_SECRET_KEY
        );

        console.log('Sending test email to', process.env.EMAIL_FROM, '...');
        
        const result = await mailjet
            .post("send", { version: 'v3.1' })
            .request({
                Messages: [
                    {
                        From: {
                            Email: process.env.EMAIL_FROM,
                            Name: "Queuify Test"
                        },
                        To: [
                            {
                                Email: process.env.EMAIL_FROM
                            }
                        ],
                        Subject: 'Mailjet Success Test',
                        TextPart: 'If you see this, your Mailjet configuration is working perfectly!',
                    }
                ]
            });

        const status = result.body.Messages[0].Status;
        if (status === 'success') {
            console.log('SUCCESS: Test email sent via Mailjet!');
        } else {
            console.warn('Mailjet responded with status:', status);
        }
    } catch (error) {
        console.error('FAILED: Mailjet test failed.');
        console.error('Error Code/Status:', error.statusCode);
        console.error('Response Message:', error.response ? error.response.statusText : error.message);
        
        if (error.statusCode === 401) {
            console.error('ADVICE: Unauthorized. Your Mailjet API Keys are incorrect.');
        } else if (error.statusCode === 403) {
            console.error('ADVICE: Forbidden. Your From Email is NOT verified in Mailjet, or your account is suspended.');
        }
    }
};

testMailjet();
