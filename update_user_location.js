const { pool } = require('./src/config/db');

async function updateTable() {
    try {
        console.log('Adding location columns to users table...');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(100)');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS state VARCHAR(100)');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS pincode VARCHAR(20)');
        console.log('Successfully updated users table.');
        process.exit(0);
    } catch (err) {
        console.error('Error updating users table:', err);
        process.exit(1);
    }
}

updateTable();
