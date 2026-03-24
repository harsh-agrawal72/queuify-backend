const { pool } = require('./src/config/db');

async function checkOrgs() {
    try {
        const { rows } = await pool.query('SELECT id, name, open_time, close_time FROM organizations');
        console.log(JSON.stringify(rows, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkOrgs();
