const { pool } = require('./src/config/db');
const appointmentModel = require('./src/models/appointment.model');

async function verify() {
    let orgId, svcId, resId, slot1Id, slot2Id, apptId;
    try {
        console.log('--- START VERIFICATION ---');

        // 1. Setup Test Data (Manual Commit)
        const orgRes = await pool.query("INSERT INTO organizations (name, slug) VALUES ('Test Org', 'test-org-' || gen_random_uuid()) RETURNING id");
        orgId = orgRes.rows[0].id;

        const svcRes = await pool.query("INSERT INTO services (org_id, name) VALUES ($1, 'Test Service') RETURNING id", [orgId,]);
        svcId = svcRes.rows[0].id;

        const resRes = await pool.query("INSERT INTO resources (org_id, name) VALUES ($1, 'Test Resource') RETURNING id", [orgId]);
        resId = resRes.rows[0].id;

        await pool.query("INSERT INTO resource_services (resource_id, service_id) VALUES ($1, $2)", [resId, svcId]);

        const slot1Res = await pool.query(
            "INSERT INTO slots (org_id, resource_id, start_time, end_time, max_capacity) VALUES ($1, $2, NOW() + interval '1 hour', NOW() + interval '2 hours', 5) RETURNING id",
            [orgId, resId]
        );
        slot1Id = slot1Res.rows[0].id;

        const slot2Res = await pool.query(
            "INSERT INTO slots (org_id, resource_id, start_time, end_time, max_capacity) VALUES ($1, $2, NOW() + interval '3 hours', NOW() + interval '4 hours', 5) RETURNING id",
            [orgId, resId]
        );
        slot2Id = slot2Res.rows[0].id;

        const apptRes = await pool.query(
            "INSERT INTO appointments (org_id, service_id, slot_id, status, preferred_date) VALUES ($1, $2, $3, 'confirmed', CURRENT_DATE) RETURNING id",
            [orgId, svcId, slot1Id]
        );
        apptId = apptRes.rows[0].id;

        console.log('Setup complete. Appt ID:', apptId);

        // 2. Test Rescheduling
        console.log('Attempting to reschedule...');
        const result = await appointmentModel.rescheduleAppointment(apptId, null, slot2Id, true, orgId);
        
        console.log('SUCCESS: Appointment rescheduled to:', result.appointment.slot_id);
        
        if (result.appointment.slot_id === slot2Id) {
            console.log('VERIFICATION PASSED: Rescheduling worked with NULL service_id on slot.');
        } else {
            console.error('VERIFICATION FAILED: Slot ID mismatch.');
        }

    } catch (e) {
        console.error('VERIFICATION FAILED with error:', e.message);
        console.error(e.stack);
    } finally {
        // Cleanup
        console.log('Cleaning up...');
        if (orgId) {
            try {
                await pool.query("DELETE FROM organizations WHERE id = $1", [orgId]);
                console.log('Cleanup successful.');
            } catch (err) {
                console.error('Cleanup failed:', err.message);
            }
        }
        await pool.end();
    }
}

verify();
