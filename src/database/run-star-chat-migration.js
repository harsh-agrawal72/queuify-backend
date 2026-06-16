const { pool } = require('../config/db');

async function runMigration() {
    console.log('Running star message migration...');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log('Adding is_starred column to messages...');
        await client.query(`
            ALTER TABLE messages 
            ADD COLUMN IF NOT EXISTS is_starred BOOLEAN DEFAULT FALSE;
        `);

        await client.query('COMMIT');
        console.log('Migration successfully completed.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration();
