const { pool } = require('./src/config/db');

const config = require('./src/config/config');

async function checkSchema() {
    try {
        console.log('Connecting to:', config.postgres.host);
        console.log('Database:', config.postgres.database);
        
        const res = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'organization_profiles'
        `);
        console.log('Columns in organization_profiles:');
        console.log(JSON.stringify(res.rows.map(r => r.column_name)));
    } catch (err) {
        console.error('Error checking schema:', err.message);
    } finally {
        await pool.end();
    }
}


checkSchema();
