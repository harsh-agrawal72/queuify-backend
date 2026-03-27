const Mailjet = require('node-mailjet');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const apiKey = process.env.MAILJET_API_KEY;
const apiSecret = process.env.MAILJET_API_SECRET;
const fromEmail = process.env.EMAIL_FROM;

console.log('API Key:', apiKey ? 'FOUND' : 'MISSING');
console.log('Secret Key:', apiSecret ? 'FOUND' : 'MISSING');
console.log('From Email:', fromEmail);

const mailjet = Mailjet.apiConnect(apiKey, apiSecret);

async function run() {
    try {
        console.log('Sending direct Mailjet request...');
        const result = await mailjet
            .post("send", { 'version': 'v3.1' })
            .request({
                "Messages": [
                    {
                        "From": {
                            "Email": fromEmail,
                            "Name": "Queuify Test"
                        },
                        "To": [
                            {
                                "Email": "harshagrawal7274@gmail.com",
                                "Name": "Harsh"
                            }
                        ],
                        "Subject": "Direct Mailjet Test",
                        "HTMLPart": "<h3>Direct Test Successful!</h3>"
                    }
                ]
            });
        console.log('Success! Status:', result.response.status);
        console.log('Body:', JSON.stringify(result.body, null, 2));
    } catch (err) {
        console.error('Direct Test Failed!');
        console.error('Status:', err.statusCode);
        if (err.response && err.response.body) {
            console.error('Error Body:', JSON.stringify(err.response.body, null, 2));
        } else {
            console.error('Error Message:', err.message);
        }
    }
}

run();
