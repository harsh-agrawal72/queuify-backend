const { pool } = require('../config/db');

async function runMigration() {
    console.log('Running conversation flags migration...');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log('Adding action flags to conversations table...');
        await client.query(`
            ALTER TABLE conversations 
            ADD COLUMN IF NOT EXISTS is_starred_by_user BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS is_starred_by_admin BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS is_blocked_by_user BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS is_blocked_by_admin BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS is_reported_by_user BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS is_reported_by_admin BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS is_deleted_by_user BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS is_deleted_by_admin BOOLEAN DEFAULT FALSE;
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
