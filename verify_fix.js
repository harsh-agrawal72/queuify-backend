const { pool } = require('./src/config/db');
const { reassignAppointments } = require('./src/services/reassignment.service');
const crypto = require('crypto');

async function test() {
    const uuidv4 = () => crypto.randomUUID();
    console.log('--- Starting Reassignment Verification ---');
    
    // Test context (from test_ids.json)
    const orgId = 'a4cc9565-109d-438e-9be3-31ce0aa33247';
    const svcId = 'acc52be6-6fd6-4a84-b99c-10232f673a57';
    const resId = '73392d6c-d966-4e4c-9eae-178d19fe8d7a';
    const userId = '6ac8f643-0bee-4b3c-9453-f08f8ece5f96';

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Create Slot 1 (Original)
        const startTime1 = new Date();
        startTime1.setDate(startTime1.getDate() + 1); // Tomorrow
        startTime1.setHours(10, 0, 0, 0);
        const endTime1 = new Date(startTime1.getTime() + 30 * 60000);

        const slot1Res = await client.query(
            `INSERT INTO slots (id, org_id, resource_id, start_time, end_time, max_capacity, booked_count, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [uuidv4(), orgId, resId, startTime1.toISOString(), endTime1.toISOString(), 1, 0, true]
        );
        const slot1Id = slot1Res.rows[0].id;
        console.log(`Created Slot 1: ${slot1Id} at ${startTime1.toISOString()}`);

        // 2. Create Appointment in Slot 1
        const apptDate = startTime1.toISOString().split('T')[0];
        const apptRes = await client.query(
            `INSERT INTO appointments (id, org_id, user_id, service_id, resource_id, slot_id, status, preferred_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [uuidv4(), orgId, userId, svcId, resId, slot1Id, 'confirmed', apptDate]
        );
        const apptId = apptRes.rows[0].id;
        
        await client.query('UPDATE slots SET booked_count = 1 WHERE id = $1', [slot1Id]);
        console.log(`Created Appointment: ${apptId} in Slot 1`);

        // 3. Create Slot 2 (Target - Next Slot)
        const startTime2 = new Date(endTime1.getTime() + 5 * 60000); // 5 mins after Slot 1
        const endTime2 = new Date(startTime2.getTime() + 30 * 60000);

        const slot2Res = await client.query(
            `INSERT INTO slots (id, org_id, resource_id, start_time, end_time, max_capacity, booked_count, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [uuidv4(), orgId, resId, startTime2.toISOString(), endTime2.toISOString(), 1, 0, true]
        );
        const slot2Id = slot2Res.rows[0].id;
        console.log(`Created Slot 2 (Target): ${slot2Id} at ${startTime2.toISOString()}`);

        // 4. Link Resource to Service (if not already linked)
        await client.query(
            `INSERT INTO resource_services (resource_id, service_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [resId, svcId]
        );

        await client.query('COMMIT');

        console.log('--- Triggering Reassignment ---');
        // This function uses its own transaction internally if it's coded that way, 
        // but it actually just uses the pool. 
        // NOTE: reassignment.service.js uses pool.connect() and BEGIN/COMMIT independently.
        await reassignAppointments(slot1Id);

        // 5. Verify reassignment
        const verifyRes = await pool.query('SELECT slot_id, status FROM appointments WHERE id = $1', [apptId]);
        const updatedAppt = verifyRes.rows[0];

        console.log(`Final Appointment State: SlotID=${updatedAppt.slot_id}, Status=${updatedAppt.status}`);

        if (updatedAppt.slot_id === slot2Id) {
            console.log('SUCCESS: Appointment correctly reassigned to Slot 2!');
        } else {
            console.log('FAILURE: Appointment was NOT reassigned to Slot 2.');
        }

        // Cleanup
        console.log('--- Cleaning Up ---');
        await pool.query('DELETE FROM appointments WHERE id = $1', [apptId]);
        await pool.query('DELETE FROM slots WHERE id IN ($1, $2)', [slot1Id, slot2Id]);
        
        console.log('Done.');
        process.exit(updatedAppt.slot_id === slot2Id ? 0 : 1);

    } catch (err) {
        console.error('ERROR during test:', err);
        if (client) await client.query('ROLLBACK').catch(() => {});
        process.exit(1);
    } finally {
        client.release();
    }
}

test();
