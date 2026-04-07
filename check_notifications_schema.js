const { pool } = require('./src/config/db');

async function checkSchema() {
    try {
        const res = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'notifications';
        `);
        console.log('Notifications Table Schema:', res.rows);
    } catch (err) {
        console.error('Check failed:', err.message);
    } finally {
        await pool.end();
        process.exit();
    }
}

checkSchema();
