const { pool } = require('../src/config/db');

async function migrate() {
    try {
        console.log('Running migration: Adding is_setup_completed to organizations...');
        await pool.query('ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_setup_completed BOOLEAN DEFAULT FALSE;');
        console.log('Migration successful.');
    } catch (err) {
        console.error('Migration failed:', err.message);
    } finally {
        await pool.end();
    }
}

migrate();
