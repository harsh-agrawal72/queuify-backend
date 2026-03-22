const httpStatus = require('../utils/httpStatus');
const { pool } = require('../config/db');
const ApiError = require('../utils/ApiError');
const emailService = require('./email.service');
const notificationService = require('./notification.service');
const userModel = require('../models/user.model');

// Helper to query DB
const query = (text, params) => {
    console.log("Executing query:", text, params);
    return pool.query(text, params);
};

const getOverview = async (orgId) => {
    try {
        // Granular Logging
        console.log("Fetching Overview for Org:", orgId);

        const totalSlotsRes = await query('SELECT COUNT(*) FROM slots WHERE org_id = $1', [orgId]);
        
        // Range-based date filtering for index usage
        const totalBookingsRes = await query(
            "SELECT COUNT(*) FROM appointments WHERE org_id = $1 AND created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + interval '1 day'",
            [orgId]
        );

        const activeBookingsRes = await query("SELECT COUNT(*) FROM appointments WHERE org_id = $1 AND status = 'confirmed'", [orgId]);

        const completedBookingsRes = await query("SELECT COUNT(*) FROM appointments WHERE org_id = $1 AND status = 'completed'", [orgId]);

        const cancelledBookingsRes = await query("SELECT COUNT(*) FROM appointments WHERE org_id = $1 AND status = 'cancelled'", [orgId]);

        // Next upcoming slot
        const nextSlotRes = await query("SELECT * FROM slots WHERE org_id = $1 AND start_time > NOW() ORDER BY start_time ASC LIMIT 1", [orgId]);
        console.log("Next Slot:", nextSlotRes.rows[0]);

        // Utilization calculation
        const totalCapacityRes = await query("SELECT COALESCE(SUM(max_capacity), 0) as cap FROM slots WHERE org_id = $1", [orgId]);
        const totalBookedRes = await query("SELECT COALESCE(SUM(booked_count), 0) as booked FROM slots WHERE org_id = $1", [orgId]);

        let utilization = 0;
        const cap = parseInt(totalCapacityRes.rows[0].cap);
        const booked = parseInt(totalBookedRes.rows[0].booked);

        if (cap > 0) {
            utilization = Math.round((booked / cap) * 100);
        }

        // Recent Activity (for Overview)
        const recentActivityRes = await query(`
            SELECT a.id, u.name as user_name, a.status, a.created_at 
            FROM appointments a
            LEFT JOIN users u ON a.user_id = u.id
            WHERE a.org_id = $1
            ORDER BY a.created_at DESC
            LIMIT 5
        `, [orgId]); // CHECK: u.name might be null if user deleted?

        const orgRes = await query('SELECT industry_type FROM organizations WHERE id = $1', [orgId]);
        const orgType = orgRes.rows[0]?.industry_type || 'Other';

        return {
            totalSlots: parseInt(totalSlotsRes.rows[0].count),
            totalBookingsToday: parseInt(totalBookingsRes.rows[0].count),
            pendingAppointments: parseInt(activeBookingsRes.rows[0].count),
            completedAppointments: parseInt(completedBookingsRes.rows[0].count),
            cancelledAppointments: parseInt(cancelledBookingsRes.rows[0].count),
            utilization: utilization,
            nextSlot: nextSlotRes.rows[0] || null,
            recentActivity: recentActivityRes.rows,
            orgType: orgType
        };
    } catch (error) {
        console.error("Error in getOverview:", error);
        throw error;
    }
};

const getOrgDetails = async (orgId) => {
    const res = await query('SELECT id, name, contact_email, org_code, industry_type, status, open_time, close_time, phone, address, email_notification, new_booking_notification, queue_mode_default FROM organizations WHERE id = $1', [orgId]);
    if (res.rows.length === 0) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found');
    return res.rows[0];
};

const updateOrgDetails = async (orgId, updateBody) => {
    const { name, contactEmail, openTime, closeTime, phone, address, email_notification, new_booking_notification, queue_mode_default } = updateBody;
    const res = await query(
        `UPDATE organizations 
         SET name = COALESCE($1, name), 
             contact_email = COALESCE($2, contact_email),
             open_time = COALESCE($3, open_time),
             close_time = COALESCE($4, close_time),
             phone = COALESCE($5, phone),
             address = COALESCE($6, address),
             email_notification = COALESCE($7, email_notification),
             new_booking_notification = COALESCE($8, new_booking_notification),
             queue_mode_default = COALESCE($9, queue_mode_default),
             updated_at = NOW()
         WHERE id = $10
         RETURNING *`,
        [name, contactEmail, openTime, closeTime, phone, address, email_notification, new_booking_notification, queue_mode_default, orgId]
    );
    return res.rows[0];
};

const getTodayQueue = async (orgId) => {
    const res = await query(`
        SELECT a.id, a.token_number, a.status, a.created_at, u.name as user_name,
        ROW_NUMBER() OVER (
            PARTITION BY (
                CASE 
                    WHEN svc.queue_scope = 'PER_RESOURCE' THEN a.slot_id::text 
                    ELSE (SELECT CONCAT(a.service_id, '_', COALESCE(sl.start_time::text, DATE(a.created_at)::text)))
                END
            )
            ORDER BY a.created_at ASC
        ) as queue_number,
        svc.name as service_name, r.name as resource_name
        FROM appointments a
        JOIN users u ON a.user_id = u.id
        JOIN services svc ON a.service_id = svc.id
        LEFT JOIN resources r ON a.resource_id = r.id
        LEFT JOIN slots sl ON a.slot_id = sl.id
        WHERE a.org_id = $1 
        AND (
            (a.slot_id IS NOT NULL AND sl.start_time >= CURRENT_DATE AND sl.start_time < CURRENT_DATE + interval '1 day')
            OR (a.slot_id IS NULL AND a.created_at >= CURRENT_DATE AND a.created_at < CURRENT_DATE + interval '1 day')
        )
        AND a.status != 'cancelled'
        ORDER BY a.created_at ASC
    `, [orgId]);
    return res.rows;
};

const getAnalytics = async (orgId, filters = {}) => {
    // ── Resolve date range ──
    const endDate = filters.endDate ? new Date(filters.endDate) : new Date();
    const startDate = filters.startDate
        ? new Date(filters.startDate)
        : new Date(new Date().setDate(endDate.getDate() - 6)); // default last 7 days
    startDate.setHours(0, 0, 0, 0);
    const endDateEnd = new Date(endDate);
    endDateEnd.setHours(23, 59, 59, 999);

    // ── Previous period (same length) ──
    const rangeDays = Math.ceil((endDateEnd - startDate) / (1000 * 60 * 60 * 24));
    const prevEnd = new Date(startDate);
    prevEnd.setMilliseconds(prevEnd.getMilliseconds() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - rangeDays + 1);
    prevStart.setHours(0, 0, 0, 0);

    // ── Dynamic WHERE fragments for optional service/resource filters ──
    let extraWhere = '';
    let slotExtraWhere = '';
    const baseParams = [orgId, startDate.toISOString(), endDateEnd.toISOString()];
    const prevParams = [orgId, prevStart.toISOString(), prevEnd.toISOString()];
    let pIdx = 4; // next param index after orgId, start, end

    if (filters.serviceId) {
        extraWhere += ` AND a.service_id = $${pIdx}`;
        slotExtraWhere += ` AND EXISTS (SELECT 1 FROM resource_services rs WHERE rs.resource_id = s.resource_id AND rs.service_id = $${pIdx})`;
        baseParams.push(filters.serviceId);
        prevParams.push(filters.serviceId);
        pIdx++;
    }
    if (filters.resourceId) {
        extraWhere += ` AND a.resource_id = $${pIdx}`;
        slotExtraWhere += ` AND s.resource_id = $${pIdx}`;
        baseParams.push(filters.resourceId);
        prevParams.push(filters.resourceId);
        pIdx++;
    }

    // ═══════════════════════════════════════
    // 1. KPI: Appointment counts by status
    // ═══════════════════════════════════════
    const kpiQuery = `
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE a.status = 'confirmed') AS confirmed,
            COUNT(*) FILTER (WHERE a.status = 'cancelled') AS cancelled,
            COUNT(*) FILTER (WHERE a.status = 'completed') AS completed,
            COUNT(*) FILTER (WHERE a.status = 'pending')   AS pending
        FROM appointments a
        WHERE a.org_id = $1 
        AND a.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' >= $2::timestamptz 
        AND a.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' <= $3::timestamptz${extraWhere}
    `;
    const kpiRes = await query(kpiQuery, baseParams);
    const kpi = kpiRes.rows[0];
    const total = parseInt(kpi.total) || 0;
    const cancelled = parseInt(kpi.cancelled) || 0;
    const confirmed = parseInt(kpi.confirmed) || 0;
    const completed = parseInt(kpi.completed) || 0;
    const pending = parseInt(kpi.pending) || 0;

    // Previous period KPI
    const prevKpiRes = await query(kpiQuery.replace(/\$2/g, '$2').replace(/\$3/g, '$3'), prevParams);
    const prevKpi = prevKpiRes.rows[0];
    const prevTotal = parseInt(prevKpi.total) || 0;
    const prevCancelled = parseInt(prevKpi.cancelled) || 0;

    // ═══════════════════════════════════════
    // 3. KPI: Slot Utilization
    // ═══════════════════════════════════════
    const utilQuery = `
        SELECT
            COALESCE(SUM(s.booked_count), 0) AS booked,
            COALESCE(SUM(s.max_capacity), 0) AS capacity
        FROM slots s
        WHERE s.org_id = $1 
        AND s.start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' >= $2::timestamptz 
        AND s.start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' <= $3::timestamptz${slotExtraWhere}
    `;
    const utilRes = await query(utilQuery, baseParams);
    const bookedTotal = parseInt(utilRes.rows[0].booked) || 0;
    const capacityTotal = parseInt(utilRes.rows[0].capacity) || 0;
    const utilization = capacityTotal > 0 ? Math.round((bookedTotal / capacityTotal) * 100) : 0;

    const prevUtilRes = await query(utilQuery, prevParams);
    const prevCapacity = parseInt(prevUtilRes.rows[0].capacity) || 0;
    const prevBooked = parseInt(prevUtilRes.rows[0].booked) || 0;
    const prevUtilization = prevCapacity > 0 ? Math.round((prevBooked / prevCapacity) * 100) : 0;

    // ═══════════════════════════════════════
    // 4. Chart: Booking Trend (daily)
    // ═══════════════════════════════════════
    const trendRes = await query(`
        SELECT 
            TO_CHAR(a.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS date, 
            COUNT(*) AS count
        FROM appointments a
        WHERE a.org_id = $1 
        AND a.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' >= $2::timestamptz 
        AND a.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' <= $3::timestamptz${extraWhere}
        GROUP BY date
        ORDER BY date ASC
    `, baseParams);

    // Fill missing dates
    const dailyBookings = [];
    const cursor = new Date(startDate);
    while (cursor <= endDateEnd) {
        // Fix: Use local date string instead of toISOString (which converts to UTC)
        const year = cursor.getFullYear();
        const month = String(cursor.getMonth() + 1).padStart(2, '0');
        const day = String(cursor.getDate()).padStart(2, '0');
        const ds = `${year}-${month}-${day}`;

        const found = trendRes.rows.find(r => r.date === ds);
        dailyBookings.push({ date: ds, count: parseInt(found?.count || 0) });
        cursor.setDate(cursor.getDate() + 1);
    }

    // ═══════════════════════════════════════
    // 5. Chart: Bookings by Service
    // ═══════════════════════════════════════
    const byServiceRes = await query(`
        SELECT svc.name AS service_name, COUNT(a.id) AS count
        FROM appointments a
        JOIN services svc ON a.service_id = svc.id
        WHERE a.org_id = $1 
        AND a.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' >= $2::timestamptz 
        AND a.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' <= $3::timestamptz${extraWhere}
        GROUP BY svc.name
        ORDER BY count DESC
    `, baseParams);

    // ═══════════════════════════════════════
    // 6. Chart: Bookings by Resource
    // ═══════════════════════════════════════
    const byResourceRes = await query(`
        SELECT COALESCE(r.name, 'Unassigned') AS resource_name, COUNT(a.id) AS count
        FROM appointments a
        LEFT JOIN resources r ON a.resource_id = r.id
        WHERE a.org_id = $1 
        AND a.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' >= $2::timestamptz 
        AND a.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' <= $3::timestamptz${extraWhere}
        GROUP BY r.name
        ORDER BY count DESC
    `, baseParams);
    const statusDistribution = [
        { name: 'Confirmed', value: confirmed, color: '#6366f1' },
        { name: 'Completed', value: completed, color: '#10b981' },
        { name: 'Cancelled', value: cancelled, color: '#ef4444' },
        { name: 'Pending', value: pending, color: '#f59e0b' },
    ].filter(s => s.value > 0);

    // ═══════════════════════════════════════
    // 8. Chart: Peak Hours Heatmap (day × hour)
    // ═══════════════════════════════════════
    const heatmapRes = await query(`
        SELECT
            EXTRACT(DOW FROM sl.start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::int AS day,
            EXTRACT(HOUR FROM sl.start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::int AS hour,
            COUNT(a.id) AS count
        FROM appointments a
        JOIN slots sl ON a.slot_id = sl.id
        WHERE a.org_id = $1 
        AND a.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' >= $2::timestamptz 
        AND a.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' <= $3::timestamptz${extraWhere}
        GROUP BY day, hour
        ORDER BY count DESC
    `, baseParams);

    // ═══════════════════════════════════════
    // 9. Smart Insights
    // ═══════════════════════════════════════
    const cancellationRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;
    const prevCancRate = prevTotal > 0 ? Math.round((prevCancelled / prevTotal) * 100) : 0;

    const bookingChange = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : 0;

    // Find peak hour from heatmap
    const peakEntry = heatmapRes.rows[0]; // Already ordered by count DESC

    const insights = [];

    // 1. Growth/Decline
    if (bookingChange > 10) {
        insights.push({ type: 'success', title: 'Momentum', message: `Bookings are up ${bookingChange}% compared to the previous period.` });
    } else if (bookingChange < -10) {
        insights.push({ type: 'warning', title: 'Slowdown', message: `Bookings have dropped ${Math.abs(bookingChange)}%. Consider a promotion.` });
    }

    // 2. Cancellation Analysis
    if (cancellationRate > 25) {
        insights.push({ type: 'danger', title: 'High Cancellations', message: `${cancellationRate}% cancellation rate.` });
    }

    // 3. Peak Times
    if (peakEntry && parseInt(peakEntry.count) > 2) {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        insights.push({ type: 'info', title: 'Busiest Time', message: `Expect high traffic on ${dayNames[peakEntry.day]}s at ${peakEntry.hour}:00.` });
    }

    // 4. Top Service
    if (byServiceRes.rows.length > 0) {
        const topSvc = byServiceRes.rows[0];
        const share = Math.round((parseInt(topSvc.count) / total) * 100);
        insights.push({ type: 'success', title: 'Top Service', message: `"${topSvc.service_name}" drives ${share}% of your appointments.` });
    }

    // 5. Utilization
    if (utilization < 40 && capacityTotal > 50) {
        insights.push({ type: 'info', title: 'Efficiency', message: `Slot utilization is low (${utilization}%). Try bundling services or off-peak discounts.` });
    }

    // Fallback
    if (insights.length === 0) {
        insights.push({ type: 'success', title: 'Everything Looks Good', message: 'Steady performance across all metrics.' });
    }

    // ═══════════════════════════════════════
    // Return
    // ═══════════════════════════════════════
    return {
        // KPIs
        totalBookings: total,
        confirmedBookings: confirmed,
        cancelledBookings: cancelled,
        completedBookings: completed,
        utilization,
        cancellationRate,
        // Growth vs previous period
        growth: {
            bookings: bookingChange,
            cancellation: prevCancRate > 0 ? cancellationRate - prevCancRate : 0,
            utilization: prevUtilization > 0 ? utilization - prevUtilization : 0,
        },
        // Charts
        dailyBookings,
        bookingsByService: byServiceRes.rows.map(r => ({ name: r.service_name, value: parseInt(r.count) })),
        bookingsByResource: byResourceRes.rows.map(r => ({ name: r.resource_name, value: parseInt(r.count) })),
        statusDistribution,
        peakHoursHeatmap: heatmapRes.rows.map(r => ({ day: parseInt(r.day), hour: parseInt(r.hour), count: parseInt(r.count) })),
        // Insights
        insights,
        // Meta
        dateRange: { start: startDate.toISOString().split('T')[0], end: endDateEnd.toISOString().split('T')[0] },
        orgName: (await query('SELECT name FROM organizations WHERE id = $1', [orgId])).rows[0]?.name || 'Organization',
        orgType: (await query('SELECT industry_type FROM organizations WHERE id = $1', [orgId])).rows[0]?.industry_type || 'Other'
    };
};

const getSlots = async (orgId, resourceId = null) => {
    let queryText = `
        SELECT s.*, r.name as resource_name 
        FROM slots s 
        LEFT JOIN resources r ON s.resource_id = r.id 
        WHERE s.org_id = $1 AND s.status != 'disabled' AND s.is_active = TRUE
    `;
    const params = [orgId];

    if (resourceId) {
        queryText += ` AND s.resource_id = $2`;
        params.push(resourceId);
    }

    queryText += ` ORDER BY s.start_time ASC`;

    const res = await query(queryText, params);
    return res.rows;
};

const createSlot = async (orgId, slotBody) => {
    const { start_time, end_time, max_capacity, resource_id } = slotBody;
    const start = new Date(start_time);
    const end = new Date(end_time);

    if (end <= start) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'End time must be after start time');
    }

    // Use default resource if not provided (for migration compatibility)
    let targetResourceId = resource_id;
    if (!targetResourceId) {
        const defaultRes = await query('SELECT id FROM resources WHERE org_id = $1 AND name = $2', [orgId, 'General Staff']);
        if (defaultRes.rows.length > 0) {
            targetResourceId = defaultRes.rows[0].id;
        }
    }

    const res = await query(
        `INSERT INTO slots (org_id, start_time, end_time, max_capacity, booked_count, resource_id, is_active)
        VALUES ($1, $2::timestamptz, $3::timestamptz, $4, 0, $5, TRUE)
        RETURNING *`,
        [orgId, start_time, end_time, max_capacity, targetResourceId]
    );
    return res.rows[0];
};

const updateSlot = async (orgId, slotId, updateBody) => {
    const { start_time, end_time, max_capacity } = updateBody;
    console.log('[updateSlot] Req body:', updateBody);

    const check = await query('SELECT id, booked_count, start_time, end_time FROM slots WHERE id = $1 AND org_id = $2', [slotId, orgId]);
    if (check.rows.length === 0) throw new ApiError(httpStatus.NOT_FOUND, 'Slot not found');

    const currentSlot = check.rows[0];
    const isPast = new Date(currentSlot.end_time) < new Date();

    // Only block if there are ACTIVE (confirmed/pending) appointments
    const activeApptCheck = await query(
        `SELECT COUNT(*) FROM appointments WHERE slot_id = $1 AND status IN ('confirmed', 'pending')`,
        [slotId]
    );
    if (parseInt(activeApptCheck.rows[0].count) > 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, "You can't modify a slot that has active (confirmed/pending) appointments");
    }

    // Also block update if slot is in the past (no point changing time of past slot)
    if (isPast && (start_time || end_time)) {
        throw new ApiError(httpStatus.BAD_REQUEST, "Cannot change the time of a past slot");
    }

    // Validate capacity if it's being updated
    if (max_capacity !== undefined) {
        if (max_capacity < currentSlot.booked_count) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Capacity cannot be less than booked seats');
        }
    }

    const res = await query(
        `UPDATE slots 
         SET start_time = COALESCE($1, start_time), 
             end_time = COALESCE($2, end_time), 
             max_capacity = COALESCE($3, max_capacity),
             updated_at = NOW()
         WHERE id = $4 AND org_id = $5 
         RETURNING *`,
        [start_time || null, end_time || null, max_capacity || null, slotId, orgId]
    );
    return res.rows[0];
};

const hardDeleteSlot = async (orgId, slotId) => {
    const client = await pool.connect();
    try {
        console.log(`[admin.service] Attempting Permanent Delete for slot ${slotId}`);
        await client.query('BEGIN');

        const check = await client.query(
            'SELECT id, booked_count, start_time, end_time FROM slots WHERE id = $1 AND org_id = $2',
            [slotId, orgId]
        );
        if (check.rows.length === 0) {
            throw new ApiError(httpStatus.NOT_FOUND, 'Slot not found');
        }

        const slot = check.rows[0];
        const isPast = new Date(slot.end_time) < new Date();
        const bookedCount = parseInt(slot.booked_count) || 0;

        // Check for ACTIVE (confirmed/pending) appointments
        const activeApptCheck = await client.query(
            `SELECT COUNT(*) FROM appointments WHERE slot_id = $1 AND status IN ('confirmed', 'pending')`,
            [slotId]
        );
        const activeCount = parseInt(activeApptCheck.rows[0].count);

        // Block deletion only if there are active appointments AND the slot is NOT in the past
        if (activeCount > 0 && !isPast) {
            throw new ApiError(
                httpStatus.BAD_REQUEST,
                "You can't delete a slot that has active (confirmed/pending) appointments"
            );
        }

        // Delete all related appointments first (past slot OR all completed/cancelled)
        const apptDeleteRes = await client.query(
            `DELETE FROM appointments WHERE slot_id = $1`,
            [slotId]
        );
        console.log(`[admin.service] Deleted ${apptDeleteRes.rowCount} appointments for slot ${slotId}`);

        // Now delete the slot
        const deleteRes = await client.query(
            `DELETE FROM slots WHERE id = $1 AND org_id = $2`,
            [slotId, orgId]
        );
        console.log(`[admin.service] Slot permanently deleted: ${deleteRes.rowCount}`);

        await client.query('COMMIT');
        return { ...slot, deleted: true };

    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[admin.service] Error during deletion:`, e);
        throw e;
    } finally {
        client.release();
    }
};

const getAppointments = async (orgId, queryParams) => {
    const { page = 1, limit = 10, status, search } = queryParams;
    const offset = (page - 1) * limit;

    let queryText = `
        SELECT 
            a.id, 
            a.status, 
            a.cancelled_by,
            a.created_at, 
            a.token_number,
            a.queue_number,
            u.name as user_name, 
            u.email as user_email, 
            u.phone as user_phone,
            s.start_time, 
            s.end_time,
            svc.name as service_name,
            r.name as resource_name
        FROM appointments a
        LEFT JOIN users u ON a.user_id = u.id
        LEFT JOIN slots s ON a.slot_id = s.id
        LEFT JOIN services svc ON a.service_id = svc.id
        LEFT JOIN resources r ON a.resource_id = r.id
        WHERE a.org_id = $1 AND (a.is_deleted_permanent IS FALSE OR a.is_deleted_permanent IS NULL)
    `;

    const params = [orgId];
    let paramCount = 1;

    if (status) {
        paramCount++;
        queryText += ` AND a.status = $${paramCount}`;
        params.push(status);
    }

    if (search) {
        paramCount++;
        queryText += ` AND (u.name ILIKE $${paramCount} OR CAST(a.token_number AS TEXT) ILIKE $${paramCount})`;
        params.push(`%${search}%`);
    }

    queryText += ` ORDER BY a.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    try {
        const res = await query(queryText, params);

        // Get total count for pagination (with same filters)
        let countQuery = 'SELECT COUNT(*) FROM appointments a LEFT JOIN users u ON a.user_id = u.id WHERE a.org_id = $1 AND (a.is_deleted_permanent IS FALSE OR a.is_deleted_permanent IS NULL)';
        const countParams = [orgId];
        let countParamCount = 1;

        if (status) {
            countParamCount++;
            countQuery += ` AND a.status = $${countParamCount}`;
            countParams.push(status);
        }

        if (search) {
            countParamCount++;
            countQuery += ` AND (u.name ILIKE $${countParamCount} OR CAST(a.token_number AS TEXT) ILIKE $${countParamCount})`;
            countParams.push(`%${search}%`);
        }

        const countRes = await query(countQuery, countParams);

        const formattedAppointments = res.rows.map(apt => {
            let displayToken = apt.token_number;
            if (!displayToken) {
                const dateStr = new Date(apt.created_at).toISOString().slice(0, 10).replace(/-/g, '');
                const suffix = apt.id.slice(-3).toUpperCase();
                displayToken = `TOKEN-${dateStr}-${suffix}`;
            }
            return {
                ...apt,
                token_number: displayToken
            };
        });

        return {
            appointments: formattedAppointments,
            totalPages: Math.ceil(parseInt(countRes.rows[0].count) / limit),
            currentPage: parseInt(page)
        };
    } catch (e) {
        console.error('[admin.service.getAppointments] Database Error:', e);
        throw e;
    }
};

const updateAppointmentStatus = async (orgId, appointmentId, status, reason = null) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const check = await client.query('SELECT id, slot_id, status, user_id, service_id, resource_id FROM appointments WHERE id = $1 AND org_id = $2', [appointmentId, orgId]);
        if (check.rows.length === 0) throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');

        const appointment = check.rows[0];

        // If cancelling an appointment, decrement slot count and save reason
        let updateQuery = `UPDATE appointments SET status = $1, updated_at = NOW()`;
        const updateParams = [status, appointmentId];

        if (status === 'cancelled') {
            updateQuery = `UPDATE appointments SET status = $1, cancelled_by = 'admin', cancellation_reason = $3, updated_at = NOW()`;
            updateParams.push(reason);
            
            if (appointment.status !== 'cancelled') {
                await client.query('UPDATE slots SET booked_count = GREATEST(booked_count - 1, 0) WHERE id = $1', [appointment.slot_id]);
            }
        }

        const res = await client.query(`${updateQuery} WHERE id = $2 RETURNING *`, updateParams);
        const updatedAppointment = res.rows[0];

        // If status changed to completed, cancelled, or no_show, trigger auto-advancement and waitlist filling
        if (['completed', 'cancelled', 'no_show'].includes(status)) {
            // Use local require to avoid circular dependency
            const { advanceQueueAutomatically } = require('./appointment.service');
            const reassignmentService = require('./reassignment.service');
            await advanceQueueAutomatically(appointment.service_id, appointment.resource_id, appointment.slot_id);
            
            if (status === 'cancelled') {
                try {
                    await reassignmentService.fillSlotFromWaitlist(appointment.slot_id);
                } catch (e) {
                    console.error('[Admin-WaitlistFill] Failed silently:', e.message);
                }
            }
        }

        // --- NOTIFICATIONS (Fire and Forget) ---
        (async () => {
            try {
                console.log(`[Email-Async] [StatusUpdate] Starting for Appointment: ${appointmentId}, New Status: ${status}`);
                const appointmentDetails = await pool.query(`
                    SELECT a.*, u.name as user_name, u.email as user_email, u.email_notification_enabled,
                           o.name as org_name, s.name as service_name
                    FROM appointments a
                    LEFT JOIN users u ON a.user_id = u.id
                    LEFT JOIN organizations o ON a.org_id = o.id
                    LEFT JOIN services s ON a.service_id = s.id
                    WHERE a.id = $1
                `, [appointmentId]);
                const data = appointmentDetails.rows[0];

                if (!data) {
                    console.error(`[Email-Async] No appointment details found for ID: ${appointmentId}`);
                    return;
                }

                console.log(`[Email-Async] Data fetched. User: ${data.user_email}, Status: ${status}`);

                if (data.user_email && data.email_notification_enabled !== false) {
                    console.log(`[Email-Async] Sending user email to ${data.user_email}`);
                    await emailService.sendStatusUpdateEmail(data.user_email, data);
                } else {
                    console.log(`[Email-Async] User email skipped (No email or disabled). Enabled: ${data.email_notification_enabled}`);
                }

                // Notify Admins of status change
                const orgRes = await pool.query('SELECT id, contact_email, email_notification, name, new_booking_notification FROM organizations WHERE id = $1', [orgId]);
                const org = orgRes.rows[0];

                if (org && org.new_booking_notification) {
                    console.log(`[Email-Async] Organization found: ${org.name}. Notifications enabled.`);
                    const admins = await userModel.getAdminsByOrg(orgId);
                    const adminMessage = `Status of ${data?.user_name || 'User'}'s appointment for ${data?.service_name || 'Service'} updated to ${status}.`;

                    // In-App Notifications to ALL admins
                    for (const admin of admins) {
                        await notificationService.sendNotification(
                            admin.id,
                            'Appointment Status Updated',
                            adminMessage,
                            'appointment',
                            `/admin/appointments?search=${appointmentId}`
                        );
                    }

                    // Email Notifications
                    if (org.email_notification) {
                        if (org.contact_email) {
                            console.log(`[Email-Async] Sending admin email to org contact: ${org.contact_email}`);
                            await emailService.sendStatusUpdateEmail(org.contact_email, data);
                        }

                        if (admins.length > 0) {
                            for (const admin of admins) {
                                if (admin.email && admin.email !== org.contact_email) {
                                    console.log(`[Email-Async] Sending admin email to secondary admin: ${admin.email}`);
                                    await emailService.sendStatusUpdateEmail(admin.email, data);
                                }
                            }
                        }
                    }
                }

                if (appointment.user_id || updatedAppointment.user_id) {
                     await notificationService.sendNotification(
                        appointment.user_id || updatedAppointment.user_id,
                        'Appointment Status Updated',
                        `Your appointment status is now ${status}.`,
                        'appointment',
                        `/appointments`
                    );
                }
            } catch (e) { console.error('[Email-Async] CRITICAL FAILURE:', e); }
        })();

        await client.query('COMMIT');
        return updatedAppointment;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const deleteAppointment = async (orgId, appointmentId, reason = null) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const check = await client.query('SELECT id, slot_id, status, user_id, service_id, resource_id, token_number FROM appointments WHERE id = $1 AND org_id = $2', [appointmentId, orgId]);
        if (check.rows.length === 0) throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');

        const appointment = check.rows[0];

        // --- STEP 1: If status is NOT cancelled, perform SOFT DELETE (mark as cancelled) ---
        if (appointment.status !== 'cancelled') {
            // If deleting a confirmed appointment, decrement slot count
            if (appointment.status === 'confirmed' || appointment.status === 'pending') {
                await client.query('UPDATE slots SET booked_count = GREATEST(booked_count - 1, 0) WHERE id = $1', [appointment.slot_id]);
            }

            const res = await client.query(
                `UPDATE appointments 
                 SET status = 'cancelled', 
                     cancelled_by = 'admin',
                     cancellation_reason = $3,
                     deleted_at = NOW() 
                 WHERE id = $1 AND org_id = $2 
                 RETURNING *`,
                [appointmentId, orgId, reason]
            );
            const cancelledAppt = res.rows[0];

            // Trigger auto-advancement and waitlist filling
            const { advanceQueueAutomatically } = require('./appointment.service');
            const reassignmentService = require('./reassignment.service');
            await advanceQueueAutomatically(appointment.service_id, appointment.resource_id, appointment.slot_id);
            try {
                await reassignmentService.fillSlotFromWaitlist(appointment.slot_id);
            } catch (e) {
                console.error('[Admin-Delete-WaitlistFill] Failed silently:', e.message);
            }

            // --- NOTIFICATIONS (Fire and Forget) ---
            (async () => {
                try {
                    console.log(`[Email-Async] [Deletion] Starting for Appointment: ${appointmentId}`);
                    const userRes = await pool.query('SELECT name, email, email_notification_enabled FROM users WHERE id = $1', [appointment.user_id]);
                    const userData = userRes.rows[0];
                    const orgRes = await pool.query('SELECT name, contact_email, email_notification FROM organizations WHERE id = $1', [orgId]);
                    const org = orgRes.rows[0];

                    if (userData && userData.email && userData.email_notification_enabled !== false) {
                        await emailService.sendCancellationEmail(userData.email, {
                            ...cancelledAppt,
                            org_name: org.name,
                            service_name: 'Your appointment'
                        });
                    }

                    if (org && org.email_notification) {
                        const admins = await userModel.getAdminsByOrg(orgId);
                        const apptDetails = {
                            ...cancelledAppt,
                            org_name: org.name,
                            service_name: 'An appointment'
                        };

                        if (org.contact_email) {
                            await emailService.sendCancellationEmail(org.contact_email, apptDetails);
                        }
                        for (const admin of admins) {
                            if (admin.email !== org.contact_email) {
                                await emailService.sendCancellationEmail(admin.email, apptDetails);
                            }
                        }
                    }

                    const notificationService = require('./notification.service');
                    await notificationService.sendNotification(
                        appointment.user_id,
                        'Appointment Cancelled',
                        `Your appointment has been cancelled by the administrator.`,
                        'appointment',
                        `/appointments`
                    );
                } catch (e) {
                    console.error('Admin cancellation notification failed:', e);
                }
            })();

            await client.query('COMMIT');
            return cancelledAppt;
        }

        // --- STEP 2: If status is ALREADY cancelled, perform PERMANENT DELETE (hide from dashboard) ---
        const res = await client.query(
            `UPDATE appointments 
             SET is_deleted_permanent = TRUE,
                 updated_at = NOW()
             WHERE id = $1 AND org_id = $2 
             RETURNING *`,
            [appointmentId, orgId]
        );
        const hiddenAppt = res.rows[0];

        await client.query('COMMIT');
        return hiddenAppt;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const getLiveQueue = async (orgId, date) => {
    const queryDate = date || new Date().toISOString().split('T')[0];

    const appointmentsRes = await pool.query(
        `SELECT
            a.id,
            a.user_id,
            a.status,
            a.created_at,
            a.token_number,
            a.service_id,
            a.resource_id,
            a.slot_id,
            sl.start_time as slot_start,
            sl.end_time as slot_end,
            u.name as user_name,
            s.name as service_name,
            s.queue_scope,
            r.name as resource_name,
            ROW_NUMBER() OVER (
                PARTITION BY (
                    CASE 
                        WHEN s.queue_scope = 'PER_RESOURCE' THEN a.resource_id::text 
                        ELSE a.service_id::text
                    END
                )
                ORDER BY COALESCE(sl.start_time, a.created_at) ASC, a.created_at ASC
            ) as queue_number
         FROM appointments a
         JOIN users u ON a.user_id = u.id
         JOIN services s ON a.service_id = s.id
         LEFT JOIN resources r ON a.resource_id = r.id
         LEFT JOIN slots sl ON a.slot_id = sl.id
         WHERE a.org_id = $1
         AND (
             (a.slot_id IS NOT NULL AND sl.start_time >= $2::date AND sl.start_time < $2::date + interval '1 day')
             OR (a.slot_id IS NULL AND a.created_at >= $2::date AND a.created_at < $2::date + interval '1 day')
         )
         AND a.status IN ('pending', 'confirmed', 'serving', 'completed', 'no_show')
         ORDER BY COALESCE(sl.start_time, a.created_at) ASC, a.created_at ASC`,
        [orgId, queryDate]
    );

    // Group by Service-Resource pair (Unified for the day)
    const queues = [];
    const appointments = appointmentsRes.rows;

    appointments.forEach(appt => {
        const isPerResource = appt.queue_scope === 'PER_RESOURCE';
        const queueId = isPerResource
            ? `resource-${appt.resource_id}`
            : `service-${appt.service_id}`;

        let queue = queues.find(q => q.id === queueId);
        if (!queue) {
            queue = {
                id: queueId,
                service_id: appt.service_id,
                resource_id: isPerResource ? appt.resource_id : null,
                name: appt.service_name,
                resource_name: isPerResource ? appt.resource_name : 'Central Queue',
                scope: appt.queue_scope,
                appointments: []
            };
            queues.push(queue);
        }
        queue.appointments.push({
            ...appt,
            queue_number: parseInt(appt.queue_number)
        });
    });

    return queues;
};

const getNotifications = async (userId) => {
    // Fetch notifications from the actual notifications table for THIS user (the admin)
    const res = await pool.query(
        `SELECT id, title, message, created_at as time, is_read, type, link
         FROM notifications 
         WHERE user_id = $1 
         ORDER BY created_at DESC 
         LIMIT 20`,
        [userId]
    );
    return res.rows;
};

const markAllNotificationsAsRead = async (userId) => {
    await notificationService.markAllAsRead(userId);
};

const globalSearch = async (orgId, searchQuery) => {
    if (!searchQuery || searchQuery.trim() === '') {
        return { services: [], resources: [], appointments: [] };
    }

    const term = `%${searchQuery.trim()}%`;
    const client = await pool.connect();

    try {
        // Search Services
        const servicesPromise = client.query(
            `SELECT id, name, description, is_active 
             FROM services 
             WHERE org_id = $1 AND name ILIKE $2 
             ORDER BY created_at DESC LIMIT 5`,
            [orgId, term]
        );

        // Search Resources
        const resourcesPromise = client.query(
            `SELECT id, name, type, is_active 
             FROM resources 
             WHERE org_id = $1 AND name ILIKE $2 
             ORDER BY created_at DESC LIMIT 5`,
            [orgId, term]
        );

        // Search Appointments (by Patient Name, Email, or Token)
        const appointmentsPromise = client.query(
            `SELECT a.id, a.token_number, a.status, a.created_at, 
                    u.name as patient_name, u.email as patient_email
             FROM appointments a
             JOIN users u ON a.user_id = u.id
             WHERE a.org_id = $1 
               AND (u.name ILIKE $2 OR CAST(a.token_number AS TEXT) ILIKE $2 OR u.email ILIKE $2)
             ORDER BY a.created_at DESC LIMIT 5`,
            [orgId, term]
        );

        const [servicesRes, resourcesRes, appointmentsRes] = await Promise.all([
            servicesPromise, resourcesPromise, appointmentsPromise
        ]);

        return {
            services: servicesRes.rows,
            resources: resourcesRes.rows,
            appointments: appointmentsRes.rows
        };
    } finally {
        client.release();
    }
};

const tokenService = require('./token.service');

const getAdmins = async (orgId) => {
    const res = await pool.query(
        `SELECT id, name, email, role, is_password_set, invited_at, activated_at, is_suspended 
         FROM users 
         WHERE org_id = $1 AND role = 'admin'
         ORDER BY created_at DESC`,
        [orgId]
    );
    return res.rows;
};

const inviteAdmin = async (adminBody, currentAdminId, orgId) => {
    const { email, name } = adminBody;

    // Check if email taken
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Email already in use');
    }

    const tempPassword = Math.random().toString(36).slice(-10);
    const hashedPassword = await require('bcryptjs').hash(tempPassword, 8);

    const res = await pool.query(
        `INSERT INTO users (name, email, password_hash, role, org_id, is_password_set, invited_at) 
         VALUES ($1, $2, $3, 'admin', $4, false, NOW()) RETURNING *`,
        [name || 'Admin', email, hashedPassword, orgId]
    );
    const newAdmin = res.rows[0];

    // Generate token
    const invToken = await tokenService.generateToken(newAdmin.id, 'admin', orgId, '7d', undefined, { type: 'invite' });
    const inviteLink = `${require('../config/config').clientUrl}/set-password?token=${invToken}`;

    // Send email
    try {
        await emailService.sendAdminInvitationEmail(email, name, inviteLink);
    } catch (e) {
        console.error('Invite email failed', e);
    }

    // Log activity
    await pool.query(
        'INSERT INTO admin_activity_logs (admin_id, action, performed_by, details) VALUES ($1, $2, $3, $4)',
        [newAdmin.id, 'INVITE_BY_ADMIN', currentAdminId, JSON.stringify({ orgId })]
    );

    return newAdmin;
};

const deleteAdmin = async (adminIdToDelete, currentAdminId, orgId) => {
    if (adminIdToDelete === currentAdminId) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'You cannot delete yourself');
    }

    // Verify admin belongs to the same org
    const check = await pool.query("SELECT id FROM users WHERE id = $1 AND org_id = $2 AND role = 'admin'", [adminIdToDelete, orgId]);
    if (check.rows.length === 0) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Admin not found or does not belong to your organization');
    }

    // Log deletion
    await pool.query(
        'INSERT INTO admin_activity_logs (admin_id, action, performed_by, details) VALUES ($1, $2, $3, $4)',
        [adminIdToDelete, 'DELETE_BY_ADMIN', currentAdminId, JSON.stringify({ orgId })]
    );

    // Delete
    const res = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id, name, email', [adminIdToDelete]);
    return res.rows[0];
};


const deleteOrganization = async (orgId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Delete admin activity logs first (no direct org link)
        await client.query(
            'DELETE FROM admin_activity_logs WHERE admin_id IN (SELECT id FROM users WHERE org_id = $1)',
            [orgId]
        );

        // Delete organization — cascades users, slots, appointments, services, resources, etc.
        const res = await client.query('DELETE FROM organizations WHERE id = $1 RETURNING id, name', [orgId]);
        if (res.rows.length === 0) {
            throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found');
        }

        await client.query('COMMIT');
        return res.rows[0];
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('[deleteOrganization] Error:', e);
        throw e;
    } finally {
        client.release();
    }
};

module.exports = {
    getOverview,
    getOrgDetails,
    updateOrgDetails,
    getTodayQueue,
    getAnalytics,
    getSlots,
    createSlot,
    updateSlot,
    deleteSlot: hardDeleteSlot,
    getAppointments,
    updateAppointmentStatus,
    deleteAppointment,
    getLiveQueue,
    getNotifications,
    markAllNotificationsAsRead,
    globalSearch,
    getAdmins,
    inviteAdmin,
    deleteAdmin,
    deleteOrganization
};

