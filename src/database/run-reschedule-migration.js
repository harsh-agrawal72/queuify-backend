// backend/src/database/run-reschedule-migration.js
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

const runMigration = async () => {
    const migrationPath = path.join(__dirname, 'migrations', '19-add-reschedule-limits.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('--- Starting Reschedule Limits Migration ---');
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
