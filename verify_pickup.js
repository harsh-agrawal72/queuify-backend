const { pool } = require('./src/config/db');
const { createSlot } = require('./src/services/slot.service');
const crypto = require('crypto');

async function test() {
    console.log('--- Starting Waitlist Pickup Verification ---');
    const uuidv4 = () => crypto.randomUUID();
    
    // Test context
    const orgId = 'a4cc9565-109d-438e-9be3-31ce0aa33247';
    const svcId = 'acc52be6-6fd6-4a84-b99c-10232f673a57';
    const resId = '73392d6c-d966-4e4c-9eae-178d19fe8d7a';
    const userId = '6ac8f643-0bee-4b3c-9453-f08f8ece5f96';

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Create one URGENT (waitlisted) and one FLEXIBLE (pending) appointment
        // Use a date 3 days from now
        const pickupDate = new Date();
        pickupDate.setDate(pickupDate.getDate() + 3);
        const dateStr = pickupDate.toISOString().split('T')[0];
        
        const apptUrgentId = uuidv4();
        await client.query(
            `INSERT INTO appointments (id, org_id, user_id, service_id, resource_id, status, preferred_date, pref_time)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [apptUrgentId, orgId, userId, svcId, resId, 'waitlisted_urgent', dateStr, 'URGENT']
        );

        const apptPendingId = uuidv4();
        await client.query(
            `INSERT INTO appointments (id, org_id, user_id, service_id, resource_id, status, preferred_date, pref_time)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [apptPendingId, orgId, userId, svcId, resId, 'pending', dateStr, 'FLEXIBLE']
        );

        await client.query('COMMIT');

        // Ensure resource is linked to service
        await pool.query('INSERT INTO resource_services (resource_id, service_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [resId, svcId]);

        console.log('--- Creating NEW Slot for the same Resource and Service ---');
        const startTime = new Date(pickupDate);
        startTime.setHours(14, 0, 0, 0); // 2:00 PM
        const endTime = new Date(startTime.getTime() + 60 * 60000); // 1 hour later

        // Trigger createSlot which should call fillSlotFromWaitlist
        const slot = await createSlot({
            orgId,
            resource_id: resId,
            start_time: startTime.toISOString(),
            end_time: endTime.toISOString(),
            max_capacity: 5
        });

        console.log(`Created Slot ID: ${slot.id}`);

        // 2. Verify results
        const results = await pool.query('SELECT id, status, slot_id FROM appointments WHERE id IN ($1, $2)', [apptUrgentId, apptPendingId]);
        console.log('Results:', results.rows);

        const urgentAppt = results.rows.find(r => r.id === apptUrgentId);
        const pendingAppt = results.rows.find(r => r.id === apptPendingId);

        if (urgentAppt.status === 'confirmed' && urgentAppt.slot_id === slot.id) {
            console.log('SUCCESS: Urgent appointment picked up!');
        } else {
            console.log('FAILURE: Urgent appointment NOT picked up. Status: ' + urgentAppt.status);
        }

        if (pendingAppt.status === 'confirmed' && pendingAppt.slot_id === slot.id) {
            console.log('SUCCESS: Pending appointment picked up!');
        } else {
            console.log('FAILURE: Pending appointment NOT picked up. Status: ' + pendingAppt.status);
        }

        // Cleanup
        await pool.query('DELETE FROM appointments WHERE id IN ($1, $2)', [apptUrgentId, apptPendingId]);
        await pool.query('DELETE FROM slots WHERE id = $1', [slot.id]);
        
        process.exit(0);

    } catch (err) {
        console.error('ERROR:', err);
        process.exit(1);
    } finally {
        client.release();
    }
}

test();
