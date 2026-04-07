const { pool } = require('./src/config/db');

async function migrate() {
    try {
        console.log('Adding push_token to users table...');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT;');
        console.log('Success!');
    } catch (err) {
        console.error('Migration failed:', err.message);
    } finally {
        await pool.end();
        process.exit();
    }
}

migrate();
