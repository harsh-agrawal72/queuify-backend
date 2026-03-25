const { pool } = require('./src/config/db');
const fs = require('fs');
async function run() {
    try {
        const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'appointments'");
        const cols = res.rows.map(r => r.column_name);
        fs.writeFileSync('cols.json', JSON.stringify(cols, null, 2));
        console.log('Columns written to cols.json');
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
