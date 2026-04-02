const { pool } = require('../src/config/db');

async function check() {
    try {
        const res = await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_NAME = 'organizations' AND COLUMN_NAME = 'is_setup_completed';");
        if (res.rows.length > 0) {
            console.log('Column is_setup_completed exists.');
        } else {
            console.log('Column is_setup_completed DOES NOT exist.');
        }
    } catch (err) {
        console.error('Check failed:', err.message);
    } finally {
        await pool.end();
    }
}

check();
