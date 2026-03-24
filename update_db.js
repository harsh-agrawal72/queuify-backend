const { pool } = require('./src/config/db');

async function updateTable() {
    try {
        console.log('Updating users table...');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture_url TEXT');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT');
        console.log('Successfully updated users table.');
        process.exit(0);
    } catch (err) {
        console.error('Error updating users table:', err);
        process.exit(1);
    }
}

updateTable();
