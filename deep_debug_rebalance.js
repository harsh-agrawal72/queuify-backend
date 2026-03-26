const { pool } = require('./src/config/db');

async function debugRebalance() {
    try {
        console.log('--- Deep Debug: Rebalance Logic ---');
        
        // 1. Get all resources that have at least one appointment today
        const today = new Date().toISOString().split('T')[0];
        const resWithData = await pool.query(`
            SELECT r.id, r.name, COUNT(a.id) as appt_count
            FROM resources r
            JOIN appointments a ON r.id = a.resource_id
            WHERE a.preferred_date = $1::date
            GROUP BY r.id, r.name
            ORDER BY appt_count DESC
        `, [today]);

        if (resWithData.rows.length === 0) {
            console.log('No resources found with appointments for today.');
            return;
        }

        for (const resource of resWithData.rows) {
            console.log(`\nChecking Resource: ${resource.name} (${resource.id})`);
            
            // 2. Check slots for this resource today
            const slots = await pool.query(`
                SELECT id, start_time, max_capacity, booked_count, is_active
                FROM slots 
                WHERE resource_id = $1 
                  AND TO_CHAR(start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') = $2
                ORDER BY start_time ASC
            `, [resource.id, today]);

            console.log(`Found ${slots.rows.length} slots for this resource today:`);
            slots.rows.forEach(s => {
                console.log(`  - Slot: ${s.start_time}, Cap: ${s.max_capacity}, Booked: ${s.booked_count}, Active: ${s.is_active}`);
            });

            if (slots.rows.length < 2) {
                console.log('  -> Not enough slots for rebalancing (need >= 2).');
                continue;
            }

            // 3. Check appointments for this resource today
            const appts = await pool.query(`
                SELECT a.id, a.slot_id, a.status, a.created_at, sl.start_time as slot_time
                FROM appointments a
                LEFT JOIN slots sl ON a.slot_id = sl.id
                WHERE a.resource_id = $1
                  AND (
                      (a.slot_id IS NOT NULL AND TO_CHAR(sl.start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') = $2)
                      OR (a.slot_id IS NULL AND a.preferred_date = $2::date)
                  )
                  AND a.status IN ('confirmed', 'pending', 'waitlisted_urgent')
            `, [resource.id, today]);

            console.log(`Found ${appts.rows.length} eligible appointments:`);
            appts.rows.forEach(a => {
                console.log(`  - Appt: ${a.id}, Current Slot: ${a.slot_id}, Status: ${a.status}`);
            });

            if (appts.rows.length === 0) {
                console.log('  -> No appointments to rebalance.');
                continue;
            }

            // 4. Trace the redistribution logic manually
            const slotDistribution = slots.rows.filter(s => s.is_active).map(s => ({ 
                id: s.id, 
                max_capacity: parseInt(s.max_capacity) || 1, 
                currentBooked: 0 
            }));

            if (slotDistribution.length < 2) {
                console.log('  -> Not enough ACTIVE slots for rebalancing.');
                continue;
            }

            let moved = 0;
            appts.rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach(appt => {
                let bestSlot = null;
                let minOccupancy = Infinity;
                slotDistribution.forEach(s => {
                    const occupancy = s.currentBooked / s.max_capacity;
                    if (occupancy < minOccupancy) {
                        minOccupancy = occupancy;
                        bestSlot = s;
                    }
                });
                if (!appt.slot_id || String(appt.slot_id) !== String(bestSlot.id)) {
                    moved++;
                }
                bestSlot.currentBooked++;
            });

            console.log(`  -> Simulation: ${moved} appointments would be moved.`);
        }

    } catch (err) {
        console.error('DEBUG FAILED:', err);
    } finally {
        await pool.end();
    }
}

debugRebalance();
