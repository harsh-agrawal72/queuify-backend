const { pool } = require('./src/config/db');

async function checkSchema() {
    try {
        const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        const tableList = tables.rows.map(r => r.table_name);
        
        const schema = {};
        for (const table of tableList) {
            const columns = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = '${table}'`);
            schema[table] = columns.rows.map(r => r.column_name);
        }
        
        console.log(JSON.stringify(schema, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkSchema();
