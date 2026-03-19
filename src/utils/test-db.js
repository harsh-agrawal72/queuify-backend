const { pool } = require('../config/db');

async function testConnection() {
    console.log('Testing DB source connection...');
    try {
        const client = await pool.connect();
        console.log('Connected successfully!');
        const res = await client.query('SELECT NOW()');
        console.log('Query result:', res.rows[0]);
        client.release();
        process.exit(0);
    } catch (err) {
        console.error('Connection failed:', err.message);
        process.exit(1);
    }
}

testConnection();
