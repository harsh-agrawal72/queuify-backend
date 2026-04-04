const { pool } = require('./src/config/db');

async function test() {
    try {
        const userId = 'a8451124-7389-4786-90f7-5ceb6e147073'; // Placeholder
        const result = await pool.query(
            `WITH QueueRanks AS (
                SELECT a.id, 
                       ROW_NUMBER() OVER (
                           PARTITION BY a.slot_id
                           ORDER BY a.created_at ASC
                       ) as calculated_queue
                FROM appointments a
                JOIN services s ON a.service_id = s.id
                WHERE a.status IN ('pending', 'confirmed', 'serving', 'completed')
             ),
             QueueMetadata AS (
                SELECT a.slot_id,
                       MIN(q.calculated_queue) FILTER (WHERE a.status = 'serving') as serving_token,
                       COUNT(*) FILTER (WHERE a.status IN ('confirmed', 'pending', 'serving')) as total_active
                FROM appointments a
                JOIN QueueRanks q ON a.id = q.id
                GROUP BY a.slot_id
             )
             SELECT a.*, 
                    COALESCE(q.calculated_queue, 0) as live_queue_number,
                    COALESCE((
                        SELECT COUNT(*) 
                        FROM appointments a2
                        JOIN QueueRanks q2 ON a2.id = q2.id
                        WHERE a2.slot_id IS NOT DISTINCT FROM a.slot_id 
                          AND a2.status IN ('confirmed', 'pending', 'serving')
                          AND q2.calculated_queue < q.calculated_queue
                    ), 0) as people_ahead,
                    qm.serving_token,
                    qm.total_active as total_in_slot,
                    u.name as user_name, u.email as user_email,
                    s.name as service_name, s.estimated_service_time, r.name as resource_name,
                    o.name as org_name, o.contact_email as org_contact_email, o.phone as org_contact_phone,
                    COALESCE(p.address, o.address) as org_address, p.city as org_city, p.state as org_state, p.pincode as org_pincode, logo.image_url as org_logo_url,
                    sl.start_time, sl.end_time, a.reschedule_count,
                    a.proposed_slot_id, a.reschedule_status, a.reschedule_reason, a.is_priority,
                    psl.start_time as proposed_start_time, psl.end_time as proposed_end_time,
                    rv.id as review_id, rv.rating as review_rating
             FROM appointments a
             LEFT JOIN QueueRanks q ON a.id = q.id
             LEFT JOIN QueueMetadata qm ON a.slot_id = qm.slot_id
             LEFT JOIN users u ON a.user_id = u.id
             LEFT JOIN services s ON a.service_id = s.id
             LEFT JOIN organizations o ON a.org_id = o.id
             LEFT JOIN organization_profiles p ON o.id = p.org_id
             LEFT JOIN (
                SELECT org_id, image_url FROM organization_images WHERE image_type = 'logo'
             ) logo ON o.id = logo.org_id
             LEFT JOIN resources r ON a.resource_id = r.id
             LEFT JOIN slots sl ON a.slot_id = sl.id
             LEFT JOIN slots psl ON a.proposed_slot_id = psl.id
             LEFT JOIN reviews rv ON a.id = rv.appointment_id
             WHERE a.user_id = $1::uuid AND a.status != 'pending_payment'
             ORDER BY a.created_at DESC`,
            [userId]
        );
        console.log('Success:', result.rows.length, 'appointments found');
    } catch (e) {
        console.error('FAILED WITH:', e.message);
    } finally {
        pool.end();
    }
}

test();
