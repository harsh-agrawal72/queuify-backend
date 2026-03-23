const adminService = require('./src/services/admin.service');
const { pool } = require('./src/config/db');

async function debugAppointments() {
    try {
        // 1. Get a valid org_id from the DB
        const orgRes = await pool.query('SELECT DISTINCT org_id FROM appointments LIMIT 1');
        if (orgRes.rows.length === 0) {
            console.log('No appointments found in the entire database.');
            return;
        }
        const orgId = orgRes.rows[0].org_id;
        console.log(`Using Org ID: ${orgId}`);

        // 2. Check total appointments for this Org without any date filters
        const total = await pool.query('SELECT COUNT(*) FROM appointments WHERE org_id = $1', [orgId]);
        console.log(`Total appointments in DB for this Org: ${total.rows[0].count}`);

        // 3. Test getAppointments with basically NO filters (just org_id)
        console.log('\n--- Testing getAppointments (No Date Filter) ---');
        const result = await adminService.getAppointments(orgId, { limit: 10, page: 1 });
        console.log(`Returned Appointments Count: ${result.appointments.length}`);
        if (result.appointments.length > 0) {
            console.log('First Appt Date:', result.appointments[0].created_at);
        }

        // 4. Test getAppointments with TODAY'S date
        const today = new Date().toISOString().split('T')[0];
        console.log(`\n--- Testing getAppointments (Date: ${today}) ---`);
        const resultToday = await adminService.getAppointments(orgId, { limit: 10, page: 1, date: today });
        console.log(`Returned Appointments Count for Today: ${resultToday.appointments.length}`);

    } catch (err) {
        console.error('DEBUG FAILED:', err);
    } finally {
        await pool.end();
    }
}

debugAppointments();
