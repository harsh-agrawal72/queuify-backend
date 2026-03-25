const { pool } = require('./src/config/db');
const { reassignAppointments } = require('./src/services/reassignment.service');
const crypto = require('crypto');
const fs = require('fs');

async function test() {
    console.log('--- Starting Preference Reassignment Verification ---');
    const uuidv4 = () => crypto.randomUUID();
    
    // Test context
    const orgId = 'a4cc9565-109d-438e-9be3-31ce0aa33247';
    const svcId = 'acc52be6-6fd6-4a84-b99c-10232f673a57';
    const resId = '73392d6c-d966-4e4c-9eae-178d19fe8d7a';
    const userId = '6ac8f643-0bee-4b3c-9453-f08f8ece5f96';

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Create Slot (to be "deleted")
        const startTime = new Date();
        startTime.setDate(startTime.getDate() + 5); // Far future
        const slotId = uuidv4();
        const endTime = new Date(startTime.getTime() + 60 * 60000); // 1 hour later
        await client.query(
            `INSERT INTO slots (id, org_id, resource_id, start_time, end_time, max_capacity, booked_count, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [slotId, orgId, resId, startTime.toISOString(), endTime.toISOString(), 10, 2, true]
        );

        // 2. Create one URGENT and one FLEXIBLE appointment
        const dateStr = startTime.toISOString().split('T')[0];
        
        const apptUrgentId = uuidv4();
        await client.query(
            `INSERT INTO appointments (id, org_id, user_id, service_id, resource_id, slot_id, status, preferred_date, pref_time)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [apptUrgentId, orgId, userId, svcId, resId, slotId, 'confirmed', dateStr, 'URGENT']
        );

        const apptFlexibleId = uuidv4();
        await client.query(
            `INSERT INTO appointments (id, org_id, user_id, service_id, resource_id, slot_id, status, preferred_date, pref_time)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [apptFlexibleId, orgId, userId, svcId, resId, slotId, 'confirmed', dateStr, 'FLEXIBLE']
        );

        const apptDefaultId = uuidv4();
        await client.query(
            `INSERT INTO appointments (id, org_id, user_id, service_id, resource_id, slot_id, status, preferred_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [apptDefaultId, orgId, userId, svcId, resId, slotId, 'confirmed', dateStr]
        );

        await client.query('UPDATE slots SET booked_count = 3 WHERE id = $1', [slotId]);
        await client.query('COMMIT');

        console.log('--- Triggering Reassignment (with NO alternative slots) ---');
        // Deactivate slot first (as per slot.service.js)
        await pool.query('UPDATE slots SET is_active = FALSE WHERE id = $1', [slotId]);
        
        // This will log to console, which we will capture
        await reassignAppointments(slotId);

        // 3. Verify results
        const results = await pool.query('SELECT id, pref_time, status FROM appointments WHERE id IN ($1, $2, $3)', [apptUrgentId, apptFlexibleId, apptDefaultId]);
        fs.writeFileSync('test_results.json', JSON.stringify(results.rows, null, 2));

        // Cleanup
        await pool.query('DELETE FROM appointments WHERE id IN ($1, $2, $3)', [apptUrgentId, apptFlexibleId, apptDefaultId]);
        await pool.query('DELETE FROM slots WHERE id = $1', [slotId]);
        
        console.log('Test completed. Results in test_results.json');
        process.exit(0);

    } catch (err) {
        console.error('ERROR:', err);
        process.exit(1);
    } finally {
        client.release();
    }
}

test();
