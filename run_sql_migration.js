const { pool } = require('./src/config/db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    const client = await pool.connect();
    try {
        const sqlPath = path.join(__dirname, 'src/database/migrations/fix_500_errors.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        console.log('Executing SQL migration from:', sqlPath);
        
        await client.query('BEGIN');
        
        // Execute the whole SQL at once – Postgres handles multiple statements
        await client.query(sql);
        
        await client.query('COMMIT');
        console.log('SQL Migration completed successfully!');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('SQL Migration failed:', err.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration();
