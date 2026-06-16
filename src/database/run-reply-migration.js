// backend/src/database/run-reply-migration.js
const { pool } = require('../config/db');

const runMigration = async () => {
    const sql = `
        ALTER TABLE messages 
        ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL;
    `;

    console.log('--- Starting Reply To ID Migration ---');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
        console.log('--- Migration Completed Successfully ---');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('--- Migration Failed ---');
        console.error(err.message);
        process.exit(1);
    } finally {
        client.release();
        process.exit(0);
    }
};

runMigration();
