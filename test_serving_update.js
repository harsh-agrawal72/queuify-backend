const adminService = require('./src/services/admin.service');
const { pool } = require('./src/config/db');

async function testServingUpdate() {
    try {
        // 1. Get a pending/confirmed appointment
        const apptRes = await pool.query("SELECT id, org_id FROM appointments WHERE status IN ('pending', 'confirmed') LIMIT 1");
        if (apptRes.rows.length === 0) {
            console.log('No eligible appointments to test with.');
            return;
        }
        const appt = apptRes.rows[0];
        console.log(`Testing Appointment ID: ${appt.id}`);

        // 2. Update to 'serving'
        await adminService.updateAppointmentStatus(appt.org_id, appt.id, 'serving');
        console.log('Updated status to SERVING');

        // 3. Check if serving_started_at is NOT NULL
        const check = await pool.query('SELECT serving_started_at, status FROM appointments WHERE id = $1', [appt.id]);
        console.log('Post-Update Data:', check.rows[0]);

        if (check.rows[0].serving_started_at) {
            console.log('SUCCESS: serving_started_at is set!');
        } else {
            console.log('FAILURE: serving_started_at is NULL!');
        }

    } catch (err) {
        console.error('TEST FAILED:', err);
    } finally {
        await pool.end();
    }
}

testServingUpdate();
