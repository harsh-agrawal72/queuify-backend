const { pool } = require('./src/config/db');
async function run() {
    const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'appointments'");
    console.log(JSON.stringify(res.rows.map(r => r.column_name), null, 2));
    process.exit(0);
}
run();
