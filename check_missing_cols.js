const { pool } = require('./src/config/db');
async function run() {
    try {
        const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'appointments'");
        const cols = res.rows.map(r => r.column_name);
        const expected = ['org_id', 'slot_id', 'user_id', 'service_id', 'resource_id', 'status', 'pref_resource', 'pref_time', 'preferred_date', 'customer_name', 'customer_phone'];
        
        console.log('Current columns:', cols.join(', '));
        console.log('Missing columns:', expected.filter(c => !cols.includes(c)).join(', '));
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
run();
