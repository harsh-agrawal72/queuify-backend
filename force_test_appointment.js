/**
 * backend/force_test_appointment.js
 */
const { pool } = require('./src/config/db');

async function forceCreate(tag, hoursOffset) {
    try {
        console.log(`Force creating test appointment [${tag}] with offset ${hoursOffset}h...`);
        
        // 1. Get an org
        const orgRes = await pool.query("SELECT id FROM organizations LIMIT 1");
        if (orgRes.rows.length === 0) return null;
        const orgId = orgRes.rows[0].id;

        // 2. Get a service or create one
        let svcRes = await pool.query("SELECT id FROM services WHERE org_id = $1 LIMIT 1", [orgId]);
        if (svcRes.rows.length === 0) {
            await pool.query("INSERT INTO services (org_id, name, price) VALUES ($1, 'Test Service', 100)", [orgId]);
            svcRes = await pool.query("SELECT id FROM services WHERE org_id = $1 LIMIT 1", [orgId]);
        }
        const svcId = svcRes.rows[0].id;

        // 3. Create a slot with specific start_time
        const startTime = new Date(Date.now() + (hoursOffset * 60 * 60 * 1000));
        const slotRes = await pool.query(
            "INSERT INTO slots (org_id, resource_id, service_id, start_time, end_time, max_capacity, is_active) VALUES ($1, NULL, $2, $3, $4, 1, TRUE) RETURNING id",
            [orgId, svcId, startTime, new Date(startTime.getTime() + 3600000)]
        );
        const slotId = slotRes.rows[0].id;

        // 4. Create a paid appointment
        const apptRes = await pool.query(
            `INSERT INTO appointments (org_id, service_id, slot_id, status, payment_status, price, payment_id, preferred_date) 
             VALUES ($1, $2, $3, 'confirmed', 'paid', 100, 'pay_test_' || $4, CURRENT_DATE) RETURNING id`,
            [orgId, svcId, slotId, tag]
        );
        const apptId = apptRes.rows[0].id;

        // 5. Prep wallet data
        await pool.query("INSERT INTO wallets (org_id, locked_funds) VALUES ($1, 100) ON CONFLICT (org_id) DO UPDATE SET locked_funds = wallets.locked_funds + 100", [orgId]);
        const walletIdRes = await pool.query("SELECT id FROM wallets WHERE org_id = $1", [orgId]);
        const walletId = walletIdRes.rows[0].id;

        await pool.query(
            "INSERT INTO wallet_transactions (wallet_id, amount, type, status, reference_id, description) VALUES ($1, 100, 'credit', 'locked', $2, 'Test Credit for ' || $3)",
            [walletId, apptId, tag]
        );
        
        return apptId;
    } catch (e) {
        console.error(e);
    }
}

async function run() {
    await forceCreate('far_future', 10); // > 6h
    await forceCreate('near_future', 2);  // < 6h
    await pool.end();
}
run();
