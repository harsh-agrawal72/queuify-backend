const config = require('./src/config/config');
const { pool } = require('./src/config/db');

async function checkSchema() {
    try {
        console.log('--- DB CONFIG ---');
        console.log('HOST:', config.postgres.host);
        console.log('DATABASE:', config.postgres.database);
        console.log('--- COLUMNS ---');
        
        const res = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'organization_profiles'
        `);
        const columns = res.rows.map(r => r.column_name);
        console.log(columns.join(', '));
        
        console.log('--- TABLE LIST ---');
        const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        console.log(tables.rows.map(t => t.table_name).join(', '));

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}

checkSchema();
