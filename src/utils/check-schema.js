const { pool } = require('../config/db');

async function checkSchema() {
    try {
        const client = await pool.connect();
        
        console.log('Checking columns in appointments table...');
        const colRes = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'appointments' AND column_name IN ('pref_resource', 'pref_time')
        `);
        console.log('Columns found:', colRes.rows);

        console.log('Checking appointment_status enum...');
        const enumRes = await client.query(`
            SELECT e.enumlabel 
            FROM pg_type t 
            JOIN pg_enum e ON t.oid = e.enumtypid 
            WHERE t.typname = 'appointment_status'
        `);
        console.log('Enum values:', enumRes.rows.map(r => r.enumlabel));

        client.release();
        process.exit(0);
    } catch (err) {
        console.error('Check failed:', err.message);
        process.exit(1);
    }
}

checkSchema();
