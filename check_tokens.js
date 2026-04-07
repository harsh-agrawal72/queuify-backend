const { pool } = require('./src/config/db');

async function checkTokens() {
    try {
        const res = await pool.query('SELECT id, name, email, push_token FROM users WHERE push_token IS NOT NULL');
        console.log('Users with Push Tokens:', res.rows);
    } catch (err) {
        console.error('Check failed:', err.message);
    } finally {
        await pool.end();
        process.exit();
    }
}

checkTokens();
