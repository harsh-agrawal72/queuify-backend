const { pool } = require('./src/config/db');
async function check() {
    try {
        console.log(`DATABASE HOST: ${process.env.POSTGRES_HOST}`);
        const apptCols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'appointments' ORDER BY column_name");
        console.log('--- APPOINTMENTS ---');
        apptCols.rows.forEach(r => console.log(`${r.column_name}: ${r.data_type}`));
        
        const count = await pool.query("SELECT COUNT(*) FROM appointments");
        console.log(`TOTAL APPOINTMENTS: ${count.rows[0].count}`);
    } catch (err) {
        console.error('ERROR:', err.message);
    } finally {
        await pool.end();
    }
}
check();
