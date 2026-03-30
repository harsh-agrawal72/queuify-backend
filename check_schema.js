const { pool } = require('./src/config/db');
async function check() {
    const res = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'organizations'
    `);
    res.rows.forEach(r => console.log(`${r.column_name}: ${r.data_type}`));
    process.exit();
}
check();
