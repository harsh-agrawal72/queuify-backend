// backend/src/database/run-presence-migration.js
const { pool } = require('../config/db');

const runMigration = async () => {
    const sql = `
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE;
    `;

    console.log('--- Starting Presence Columns Migration ---');
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
