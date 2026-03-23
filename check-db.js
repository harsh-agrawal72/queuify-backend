const { pool } = require('./src/config/db');
async function check() {
    try {
        const nullCheck = await pool.query("SELECT COUNT(*) FROM appointments WHERE status = 'completed' AND serving_started_at IS NULL");
        console.log(`\nCompleted appointments with NULL serving_started_at: ${nullCheck.rows[0].count}`);
        
        const nullCheck2 = await pool.query("SELECT COUNT(*) FROM appointments WHERE status = 'completed' AND completed_at IS NULL");
        console.log(`Completed appointments with NULL completed_at: ${nullCheck2.rows[0].count}`);
    } catch (err) {
        console.error('ERROR:', err.message);
    } finally {
        await pool.end();
    }
}
check();
