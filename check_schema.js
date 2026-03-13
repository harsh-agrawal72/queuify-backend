const { pool } = require('./src/config/db');

async function checkSchema() {
    try {
        const orgCols = await pool.query(`
            SELECT column_name, column_default, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'organizations'
        `);
        const userCols = await pool.query(`
            SELECT column_name, column_default, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'users'
        `);

        console.log('--- Organizations Columns ---');
        orgCols.rows.filter(c => c.column_name.includes('notification') || c.column_name.includes('email')).forEach(c => {
            console.log(`${c.column_name}: default=[${c.column_default}], type=${c.data_type}`);
        });

        console.log('\n--- Users Columns ---');
        userCols.rows.filter(c => c.column_name.includes('notification') || c.column_name.includes('email')).forEach(c => {
            console.log(`${c.column_name}: default=[${c.column_default}], type=${c.data_type}`);
        });

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkSchema();
