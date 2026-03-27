const { Resend } = require('resend');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const apiKey = process.env.RESEND_API_KEY;
const resend = new Resend(apiKey);

async function run() {
    console.log('--- Verbose Resend Test ---');
    console.log('API Key:', apiKey ? 'FOUND' : 'MISSING');
    
    try {
        const to = 'harshagrawal7274@gmail.com';
        console.log(`Sending to: ${to}`);
        
        const { data, error } = await resend.emails.send({
            from: 'Queuify <onboarding@resend.dev>',
            to: [to],
            subject: 'Verbose Test',
            html: '<strong>Success!</strong>'
        });

        if (error) {
            console.error('API returned an error object:');
            console.error(JSON.stringify(error, null, 2));
        } else {
            console.log('API returned success data:');
            console.log(JSON.stringify(data, null, 2));
        }
    } catch (err) {
        console.error('Caught an unexpected exception:');
        console.error(err);
    }
}

run();
