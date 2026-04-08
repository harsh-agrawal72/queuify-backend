// backend/src/database/run-priority-migration.js
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

const runMigration = async () => {
    const migrationPath = path.join(__dirname, 'migrations', '17-add-priority-flag.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('--- Starting Priority Flag Migration ---');
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
