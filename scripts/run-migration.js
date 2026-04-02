const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');

const runMigration = async () => {
    const migrationPath = path.join(__dirname, '../src/migrations/12-add-org-setup-status.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('Running migration: 12-add-org-setup-status.sql...');
    try {
        await pool.query(sql);
        console.log('Migration completed successfully!');
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
        process.exit(0);
    }
};

runMigration();
