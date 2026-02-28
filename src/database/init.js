const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

const schemaPath = path.join(__dirname, 'schema.sql');

const initDb = async () => {
    try {
        const sql = fs.readFileSync(schemaPath, 'utf8');
        console.log('Executing schema...');
        await pool.query(sql);
        console.log('Schema applied successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Error applying schema:', err);
        process.exit(1);
    }
};

initDb();
