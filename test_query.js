const { pool } = require('./src/config/db');
async function run() {
    try {
        const res = await pool.query(`
            SELECT a.id, a.preferred_date 
            FROM appointments a 
            LIMIT 1
        `);
        console.log('Success:', res.rows);
    } catch (e) {
        console.error('Failure:', e.message);
    } finally {
        process.exit(0);
    }
}
run();
