const { pool } = require('../config/db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    const migrationPath = path.join(__dirname, '../database/migrations/add_preferred_date.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    const client = await pool.connect();
    try {
        console.log('Running migration: add_preferred_date.sql');
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', err.message);
        process.exit(1);
    } finally {
        client.release();
    }
}

runMigration();
