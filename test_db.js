const { pool } = require('./src/config/db'); 
pool.query('SELECT id, status, payment_status, price, razorpay_refund_id FROM appointments WHERE status = \'cancelled\' ORDER BY updated_at DESC LIMIT 5')
.then(res => console.log(res.rows))
.catch(console.error)
.finally(() => pool.end());
