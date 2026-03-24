const { pool } = require('./src/config/db');

async function check() {
    const apptId = '035677e4-c75d-4d78-85fb-6c41540ccb2c';
    try {
        const apptRes = await pool.query('SELECT id, service_id, slot_id FROM appointments WHERE id = $1', [apptId]);
        console.log('Appointment:', apptRes.rows[0]);

        if (apptRes.rows[0]) {
            const svcId = apptRes.rows[0].service_id;
            const slotsRes = await pool.query('SELECT id, service_id, start_time FROM slots WHERE service_id = $1 LIMIT 5', [svcId]);
            console.log('Slots for this Service ID:', slotsRes.rows);

            const allSlotsCount = await pool.query('SELECT count(*) FROM slots WHERE service_id = $1', [svcId]);
            console.log('Total slots for this Service ID:', allSlotsCount.rows[0].count);
        }
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

check();
