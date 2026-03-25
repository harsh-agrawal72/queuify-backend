const { pool } = require('./src/config/db');
async function run() {
    try {
        const res = await pool.query('SELECT id FROM appointments LIMIT 1');
        if (res.rows.length === 0) {
            console.log('No appointments to test update.');
            return;
        }
        const id = res.rows[0].id;
        console.log(`Testing UPDATE for appt: ${id}`);
        await pool.query(
            `UPDATE appointments SET preferred_date = CURRENT_DATE WHERE id = $1`,
            [id]
        );
        console.log('Update Success!');
    } catch (e) {
        console.error('Update Failure:', e.message);
    } finally {
        process.exit(0);
    }
}
run();
