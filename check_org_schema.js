const { pool } = require('./src/config/db');

async function checkSchema() {
    try {
        const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'organization_profiles'");
        const columns = res.rows.map(r => r.column_name);
        console.log('COLUMNS_START');
        console.log(JSON.stringify(columns));
        console.log('COLUMNS_END');
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkSchema();
