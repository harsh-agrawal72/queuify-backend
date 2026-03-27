const { pool } = require('./src/config/db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    try {
        const sql = fs.readFileSync(path.join(__dirname, 'src/migrations/9-upgrade-slot-notifications.sql'), 'utf8');
        console.log('Running migration 9...');
        await pool.query(sql);
        console.log('Migration 9 successful!');
        process.exit(0);
    } catch (err) {
        console.error('Migration 9 failed:', err.message);
        process.exit(1);
    }
}

runMigration();
