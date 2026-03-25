const { pool } = require('./src/config/db');
const slotService = require('./src/services/slot.service');

async function verify() {
    console.log('--- Starting Waitlist Pickup Verification (Dr ujjawal) ---');
    
    try {
        // 1. Get Dr ujjawal and his organization/service
        const resRes = await pool.query('SELECT id, org_id, service_id FROM resources WHERE name LIKE \'%ujjawal%\' LIMIT 1');
        if (resRes.rows.length === 0) {
            console.error('Dr ujjawal not found in DB. Please make sure he exists.');
            return;
        }
        const { id: resourceId, org_id: orgId, service_id: serviceId } = resRes.rows[0];

        const userRes = await pool.query('SELECT id FROM users LIMIT 1');
        const userId = userRes.rows[0].id;

        console.log(`Using Org=${orgId}, Svc=${serviceId}, Res=${resourceId} (Dr ujjawal)`);

        const today = new Date();
        const localDate = today.toISOString().split('T')[0];

        // 2. Create Waitlisted Appointments
        const appt1Res = await pool.query(
            `INSERT INTO appointments (org_id, service_id, resource_id, status, pref_time, user_id, preferred_date, customer_name)
             VALUES ($1, $2, $3, 'waitlisted_urgent', 'URGENT', $4, $5, 'Urgent User') RETURNING id`,
            [orgId, serviceId, resourceId, userId, localDate]
        );
        const appt1Id = appt1Res.rows[0].id;

        const appt2Res = await pool.query(
            `INSERT INTO appointments (org_id, service_id, resource_id, status, pref_time, user_id, preferred_date, customer_name)
             VALUES ($1, $2, $3, 'pending', 'FLEXIBLE', $4, $5, 'Pending User') RETURNING id`,
            [orgId, serviceId, resourceId, userId, localDate]
        );
        const appt2Id = appt2Res.rows[0].id;

        console.log(`Created Appointments: Urgent=${appt1Id}, Pending=${appt2Id}`);

        // 3. Create a NEW Slot (should trigger waitlist pickup)
        console.log('--- Creating New Slot ---');
        const newSlot = await slotService.createSlot({
            orgId,
            resource_id: resourceId,
            start_time: today.toISOString(),
            end_time: new Date(today.getTime() + 3600000).toISOString(),
            max_capacity: 5
        });

        console.log(`Created Slot ${newSlot.id}`);

        // 4. Verify results
        const appt1Check = await pool.query('SELECT status, slot_id FROM appointments WHERE id = $1', [appt1Id]);
        const appt2Check = await pool.query('SELECT status, slot_id FROM appointments WHERE id = $1', [appt2Id]);

        console.log(`Urgent Appt Status: ${appt1Check.rows[0].status}, Slot: ${appt1Check.rows[0].slot_id}`);
        console.log(`Pending Appt Status: ${appt2Check.rows[0].status}, Slot: ${appt2Check.rows[0].slot_id}`);

        if (appt1Check.rows[0].status === 'confirmed' && appt1Check.rows[0].slot_id === newSlot.id) {
            console.log('SUCCESS: Urgent appointment picked up via fallback!');
        } else {
            console.error('FAILED: Urgent appointment NOT picked up.');
        }

        if (appt2Check.rows[0].status === 'confirmed' && appt2Check.rows[0].slot_id === newSlot.id) {
            console.log('SUCCESS: Pending appointment picked up via fallback!');
        } else {
            console.error('FAILED: Pending appointment NOT picked up.');
        }

        // Cleanup
        await pool.query('DELETE FROM appointments WHERE id IN ($1, $2)', [appt1Id, appt2Id]);
        await pool.query('DELETE FROM slots WHERE id = $1', [newSlot.id]);

    } catch (e) {
        console.error('Test Execution Error:', e);
    } finally {
        process.exit(0);
    }
}

verify();
