const dotenv = require('dotenv');
const Razorpay = require('razorpay');

dotenv.config();

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;

console.log('Testing Razorpay Initialization in Backend...');
console.log('Key ID:', keyId);
console.log('Key Secret length:', keySecret ? keySecret.length : 0);

if (!keyId || !keySecret) {
    console.error('CRITICAL: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing from .env');
    process.exit(1);
}

try {
    const rzp = new Razorpay({
        key_id: keyId,
        key_secret: keySecret,
    });
    console.log('Razorpay instance created successfully.');
    
    // Test a basic call to list orders (minimal impact)
    rzp.orders.all({ count: 1 }).then(orders => {
        console.log('Successfully connected to Razorpay API. Orders found:', orders.items.length);
        process.exit(0);
    }).catch(err => {
        console.error('Razorpay API Error:', JSON.stringify(err, null, 2));
        process.exit(1);
    });
} catch (err) {
    console.error('Initialization Failed:', err);
    process.exit(1);
}
