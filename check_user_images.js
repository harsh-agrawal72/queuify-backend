const { pool } = require('./src/config/db');

async function checkTable() {
    try {
        const { rows } = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_name = 'user_images'");
        console.log(rows);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkTable();
