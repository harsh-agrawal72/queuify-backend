const httpStatus = require('../utils/httpStatus');
const { pool } = require('../config/db');
const ApiError = require('../utils/ApiError');
const emailService = require('./email.service');
const notificationService = require('./notification.service');
const userModel = require('../models/user.model');
const walletService = require('./wallet.service');
const autoRefundService = require('./autoRefund.service');
const socket = require('../socket/index');

// Helper to query DB
const query = (text, params) => {
    return pool.query(text, params);
};

// Cache for column names to avoid excessive information_schema queries
const columnCache = {};
const getColumnNames = async (tableName) => {
    if (columnCache[tableName]) return columnCache[tableName];
    const res = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = $1",
        [tableName]
    );
    const cols = res.rows.map(r => r.column_name);
    columnCache[tableName] = cols;
    return cols;
};

const getOverview = async (orgId) => {
    try {
        // Granular Logging
        console.log("Fetching Overview for Org:", orgId);

        // Parallelize all independent KPI queries
        const [
            totalSlotsRes,
            totalBookingsRes,
            activeBookingsRes,
            completedBookingsRes,
            cancelledBookingsRes,
            nextSlotRes,
            totalCapacityRes,
            totalBookedRes,
            recentActivityRes,
            orgRes
        ] = await Promise.all([
            query('SELECT COUNT(*) FROM slots WHERE org_id = $1', [orgId]),
            query("SELECT COUNT(*) FROM appointments WHERE org_id = $1 AND created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + interval '1 day'", [orgId]),
            query("SELECT COUNT(*) FROM appointments WHERE org_id = $1 AND status = 'confirmed'", [orgId]),
            query("SELECT COUNT(*) FROM appointments WHERE org_id = $1 AND status = 'completed'", [orgId]),
            query("SELECT COUNT(*) FROM appointments WHERE org_id = $1 AND status = 'cancelled'", [orgId]),
            query("SELECT * FROM slots WHERE org_id = $1 AND start_time > NOW() ORDER BY start_time ASC LIMIT 1", [orgId]),
            query("SELECT COALESCE(SUM(max_capacity), 0) as cap FROM slots WHERE org_id = $1", [orgId]),
            query("SELECT COALESCE(SUM(booked_count), 0) as booked FROM slots WHERE org_id = $1", [orgId]),
            query(`
                SELECT a.id, u.name as user_name, a.status, a.created_at 
                FROM appointments a
                LEFT JOIN users u ON a.user_id = u.id
                WHERE a.org_id = $1
                ORDER BY a.created_at DESC
                LIMIT 5
            `, [orgId]),
            query('SELECT industry_type FROM organizations WHERE id = $1', [orgId])
        ]);

        console.log("Next Slot:", nextSlotRes.rows[0]);
        const orgType = orgRes.rows[0]?.industry_type || 'Other';

        const totalCapacity = parseInt(totalCapacityRes.rows[0].cap) || 0;
        const totalBooked = parseInt(totalBookedRes.rows[0].booked) || 0;
        const utilization = totalCapacity > 0 ? Math.round((totalBooked / totalCapacity) * 100) : 0;

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
    const res = await query(`
        SELECT id, name, slug, contact_email, org_code, industry_type, status, 
               open_time, close_time, phone, address, 
               email_notification, new_booking_notification, queue_mode_default,
               payout_bank_name, payout_account_holder, payout_account_number, payout_ifsc, payout_upi_id
        FROM organizations WHERE id = $1`, [orgId]);
    if (res.rows.length === 0) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found');
    return res.rows[0];
};

const updateOrgDetails = async (orgId, updateBody) => {
    const { 
        name, contactEmail, openTime, closeTime, phone, address, 
        email_notification, new_booking_notification, queue_mode_default,
        payout_bank_name, payout_account_holder, payout_account_number, payout_ifsc, payout_upi_id
    } = updateBody;
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
             payout_bank_name = COALESCE($10, payout_bank_name),
             payout_account_holder = COALESCE($11, payout_account_holder),
             payout_account_number = COALESCE($12, payout_account_number),
             payout_ifsc = COALESCE($13, payout_ifsc),
             payout_upi_id = COALESCE($14, payout_upi_id),
             updated_at = NOW()
         WHERE id = $15
         RETURNING *`,
        [
            name, contactEmail, openTime, closeTime, phone, address, 
            email_notification, new_booking_notification, queue_mode_default,
            payout_bank_name, payout_account_holder, payout_account_number, payout_ifsc, payout_upi_id,
            orgId
        ]
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
        ) as queue_number
        FROM appointments a
        JOIN services svc ON a.service_id = svc.id
        LEFT JOIN users u ON a.user_id = u.id
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

    // ── Pre-process dates to standardized strings ──
    const dStart = startDate.toISOString().split('T')[0];
    const dEnd = endDateEnd.toISOString().split('T')[0];
    const dPrevStart = prevStart.toISOString().split('T')[0];
    const dPrevEnd = prevEnd.toISOString().split('T')[0];

    // ── Dynamic WHERE fragments for optional service/resource filters ──
    let extraWhere = '';
    let slotExtraWhere = '';
    const baseParams = [orgId, dStart, dEnd];
    const prevParams = [orgId, dPrevStart, dPrevEnd];
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
    // 1. All Analytical Queries (Parallelized)
    // ═══════════════════════════════════════
    const kpiQuery = `
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE a.status::text IN ('confirmed', 'booked', 'serving', 'completed')) AS confirmed,
            COUNT(*) FILTER (WHERE a.status::text = 'cancelled') AS cancelled,
            COUNT(*) FILTER (WHERE a.status::text = 'completed') AS completed,
            COUNT(*) FILTER (WHERE a.status::text = 'pending')   AS pending
        FROM appointments a
        WHERE a.org_id = $1 
        AND a.created_at::date >= $2::date 
        AND a.created_at::date <= $3::date${extraWhere}
    `;

    // 3. Utilization / Volume (Denominator)
    const utilQuery = `
        SELECT
            COALESCE(SUM(s.max_capacity), 0) AS capacity
        FROM slots s
        WHERE s.org_id = $1 
        AND s.start_time::date >= $2::date 
        AND s.start_time::date <= $3::date${slotExtraWhere}
    `;

    // Utilization / Volume (Numerator)
    // We count non-cancelled appointments that are either in a slot in this range
    // OR are walk-ins created in this range.
    const volumeQuery = `
        SELECT COUNT(*) as volume
        FROM appointments a
        WHERE a.org_id = $1
        AND a.status NOT IN ('cancelled', 'no_show')
        AND (
            (a.slot_id IS NOT NULL AND EXISTS (SELECT 1 FROM slots s WHERE s.id = a.slot_id AND s.start_time::date >= $2::date AND s.start_time::date <= $3::date))
            OR (a.slot_id IS NULL AND a.created_at::date >= $2::date AND a.created_at::date <= $3::date)
        )${extraWhere}
    `;

    const trendQuery = `
        SELECT 
            TO_CHAR(a.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS date, 
            COUNT(*) AS count
        FROM appointments a
        WHERE a.org_id = $1 
        AND a.created_at::date >= $2::date 
        AND a.created_at::date <= $3::date${extraWhere}
        GROUP BY date
        ORDER BY date ASC
    `;

    const byServiceQuery = `
        SELECT svc.name AS service_name, COUNT(a.id) AS count
        FROM appointments a
        JOIN services svc ON a.service_id = svc.id
        WHERE a.org_id = $1 
        AND a.created_at::date >= $2::date 
        AND a.created_at::date <= $3::date${extraWhere}
        GROUP BY svc.name
        ORDER BY count DESC
    `;

    const byResourceQuery = `
        SELECT COALESCE(r.name, 'Unassigned') AS resource_name, COUNT(a.id) AS count
        FROM appointments a
        LEFT JOIN resources r ON a.resource_id = r.id
        WHERE a.org_id = $1 
        AND a.created_at::date >= $2::date 
        AND a.created_at::date <= $3::date${extraWhere}
        GROUP BY r.name
        ORDER BY count DESC
    `;

    const heatmapQuery = `
        SELECT
            EXTRACT(DOW FROM event_time AT TIME ZONE 'Asia/Kolkata')::int AS day,
            EXTRACT(HOUR FROM event_time AT TIME ZONE 'Asia/Kolkata')::int AS hour,
            COUNT(*) AS count
        FROM (
            SELECT 
                COALESCE(sl.start_time, a.created_at) as event_time
            FROM appointments a
            LEFT JOIN slots sl ON a.slot_id = sl.id
            WHERE a.org_id = $1
            AND a.status NOT IN ('cancelled', 'no_show')
            AND (
                (a.slot_id IS NOT NULL AND sl.start_time >= $2::timestamptz AND sl.start_time <= $3::timestamptz)
                OR (a.slot_id IS NULL AND a.created_at >= $2::timestamptz AND a.created_at <= $3::timestamptz)
            )${extraWhere}
        ) sub
        GROUP BY day, hour
        ORDER BY count DESC
    `;

    const [
        kpiRes,           // 0
        prevKpiRes,       // 1
        utilRes,          // 2
        prevUtilRes,      // 3
        volumeRes,        // 4
        prevVolumeRes,    // 5
        trendRes,         // 6
        byServiceRes,     // 7
        byResourceRes,    // 8
        heatmapRes        // 9
    ] = await Promise.all([
        query(kpiQuery, baseParams),
        query(kpiQuery, prevParams),
        query(utilQuery, baseParams),
        query(utilQuery, prevParams),
        query(volumeQuery, baseParams),
        query(volumeQuery, prevParams),
        query(trendQuery, baseParams),
        query(byServiceQuery, baseParams),
        query(byResourceQuery, baseParams),
        query(heatmapQuery, baseParams)
    ]);

    // ── KPI Processing ──
    const kpi = kpiRes.rows[0];
    const total = parseInt(kpi.total) || 0;
    const cancelled = parseInt(kpi.cancelled) || 0;
    const confirmed = parseInt(kpi.confirmed) || 0;
    const completed = parseInt(kpi.completed) || 0;
    const pending = parseInt(kpi.pending) || 0;

    const prevKpi = prevKpiRes.rows[0];
    const prevTotal = parseInt(prevKpi.total) || 0;
    const prevCancelled = parseInt(prevKpi.cancelled) || 0;

    // ── Utilization Processing (The Precise Formula) ──
    const capacityTotal = parseInt(utilRes.rows[0].capacity) || 0;
    const bookedVolume = parseInt(volumeRes.rows[0].volume) || 0; 
    
    // Utilization = (Bookings linked to slots in period / Capacity of slots in period) * 100. 
    // We cap at 100% and show 0% if no capacity is defined.
    const utilization = capacityTotal > 0 
        ? Math.min(Math.round((bookedVolume / capacityTotal) * 100), 100)
        : 0;

    const prevCapacity = parseInt(prevUtilRes.rows[0].capacity) || 0;
    const prevBookedVolume = parseInt(prevVolumeRes.rows[0].volume) || 0;
    const prevUtilization = prevCapacity > 0 
        ? Math.min(Math.round((prevBookedVolume / prevCapacity) * 100), 100)
        : 0;

    // ── Daily Trend Processing ──
    const dailyBookings = [];
    const cursor = new Date(startDate);
    while (cursor <= endDateEnd) {
        const year = cursor.getFullYear();
        const month = String(cursor.getMonth() + 1).padStart(2, '0');
        const day = String(cursor.getDate()).padStart(2, '0');
        const ds = `${year}-${month}-${day}`;

        const found = trendRes.rows.find(r => r.date === ds);
        dailyBookings.push({ date: ds, count: parseInt(found?.count || 0) });
        cursor.setDate(cursor.getDate() + 1);
    }

    const statusDistribution = [
        { name: 'Confirmed', value: confirmed, color: '#6366f1' },
        { name: 'Completed', value: completed, color: '#10b981' },
        { name: 'Cancelled', value: cancelled, color: '#ef4444' },
        { name: 'Pending', value: pending, color: '#f59e0b' },
    ].filter(s => s.value > 0);

    // ═══════════════════════════════════════
    // 9. Smart Insights
    // ═══════════════════════════════════════
    const cancellationRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;
    const prevCancRate = prevTotal > 0 ? Math.round((prevCancelled / prevTotal) * 100) : 0;

    const bookingChange = (prevTotal > 0 && isFinite(total)) ? Math.round(((total - prevTotal) / prevTotal) * 100) : 0;

    // Find peak hour from heatmap
    const peakEntry = (heatmapRes.rows && heatmapRes.rows[0]) ? heatmapRes.rows[0] : null;

    const insights = [];

    // 1. Growth/Decline
    if (bookingChange > 10) {
        insights.push({ type: 'success', title: 'Momentum', message: `Bookings are up ${bookingChange}% compared to the previous period.` });
    } else if (bookingChange < -10) {
        insights.push({ type: 'warning', title: 'Slowdown', message: `Bookings have dropped ${Math.abs(bookingChange)}%. Consider a promotion.` });
    }

    // 2. Cancellation Analysis
    if (isFinite(cancellationRate) && cancellationRate > 25) {
        insights.push({ type: 'danger', title: 'High Cancellations', message: `${cancellationRate}% cancellation rate.` });
    }

    // 3. Peak Times
    if (peakEntry && isFinite(peakEntry.count) && parseInt(peakEntry.count) > 2) {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const pDay = parseInt(peakEntry.day);
        const pHour = parseInt(peakEntry.hour);
        if (isFinite(pDay) && isFinite(pHour) && dayNames[pDay]) {
            insights.push({ type: 'info', title: 'Busiest Time', message: `Expect high traffic on ${dayNames[pDay]}s at ${pHour}:00.` });
        }
    }

    // 4. Top Service
    if (byServiceRes.rows && byServiceRes.rows.length > 0) {
        const topSvc = byServiceRes.rows[0];
        const topSvcCount = parseInt(topSvc.count);
        if (total > 0 && isFinite(topSvcCount)) {
            const share = Math.round((topSvcCount / total) * 100);
            insights.push({ type: 'success', title: 'Top Service', message: `"${topSvc.service_name}" drives ${share}% of your appointments.` });
        }
    }

    // 5. Utilization
    if (isFinite(utilization) && utilization < 40 && capacityTotal > 50) {
        insights.push({ type: 'info', title: 'Efficiency', message: `Slot utilization is low (${utilization}%). Try bundling services or off-peak discounts.` });
    }

    // Fallback
    if (insights.length === 0) {
        insights.push({ type: 'success', title: 'Everything Looks Good', message: 'Steady performance across all metrics.' });
    }

    // 10. Organization Meta
    let orgName = 'Organization';
    let orgType = 'Other';
    try {
        const orgMetaRes = await query('SELECT name, industry_type FROM organizations WHERE id = $1', [orgId]);
        if (orgMetaRes.rows && orgMetaRes.rows[0]) {
            orgName = orgMetaRes.rows[0].name || 'Organization';
            orgType = orgMetaRes.rows[0].industry_type || 'Other';
        }
    } catch (e) { console.error('OrgMeta fetch error:', e); }

    // 11. Date Range Formatting
    let startStr = '';
    let endStr = '';
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
        startStr = formatter.format(startDate);
        endStr = formatter.format(endDateEnd);
    } catch (e) {
        startStr = startDate.toISOString().split('T')[0];
        endStr = endDateEnd.toISOString().split('T')[0];
    }

    // ═══════════════════════════════════════
    // Return
    // ═══════════════════════════════════════
    const safeNum = (val) => (isFinite(val) && !isNaN(val)) ? val : 0;
    
    return {
        // KPIs
        totalBookings: safeNum(total),
        confirmedBookings: safeNum(confirmed),
        cancelledBookings: safeNum(cancelled),
        completedBookings: safeNum(completed),
        utilization: safeNum(utilization),
        cancellationRate: safeNum(cancellationRate),
        // Growth vs previous period
        growth: {
            bookings: safeNum(bookingChange),
            cancellation: (prevCancRate > 0 && isFinite(prevCancRate)) ? safeNum(cancellationRate - prevCancRate) : 0,
            utilization: (prevUtilization > 0 && isFinite(prevUtilization)) ? safeNum(utilization - prevUtilization) : 0,
        },
        // Charts
        dailyBookings: dailyBookings || [],
        bookingsByService: (byServiceRes.rows || []).map(r => ({ name: r.service_name || 'Other', value: safeNum(parseInt(r.count)) })),
        bookingsByResource: (byResourceRes.rows || []).map(r => ({ name: r.resource_name || 'Unassigned', value: safeNum(parseInt(r.count)) })),
        statusDistribution: statusDistribution || [],
        peakHoursHeatmap: (heatmapRes.rows || []).map(r => {
            const d = parseInt(r.day);
            const h = parseInt(r.hour);
            const c = parseInt(r.count);
            return { 
                day: isFinite(d) ? d : 0, 
                hour: isFinite(h) ? h : 0, 
                count: isFinite(c) ? c : 0 
            };
        }),
        // Insights
        insights: insights || [],
        // Meta
        dateRange: { 
            start: startStr, 
            end: endStr 
        },
        orgName,
        orgType
    };
};

const getSlots = async (orgId, resourceId = null, date = null) => {
    let queryText = `
        SELECT s.*, r.name as resource_name 
        FROM slots s 
        LEFT JOIN resources r ON s.resource_id = r.id 
        WHERE s.org_id = $1 AND s.status != 'disabled' AND s.is_active = TRUE
    `;
    const params = [orgId];

    if (resourceId) {
        params.push(resourceId);
        queryText += ` AND s.resource_id = $${params.length}`;
    }

    if (date) {
        params.push(date);
        queryText += ` AND s.start_time >= $${params.length}::date AND s.start_time < $${params.length}::date + interval '1 day'`;
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
    const newSlot = res.rows[0];

    // Trigger waitlist filling for the new slot
    try {
        const { fillSlotFromWaitlist } = require('./reassignment.service');
        // We do this in a "fire and forget" or at least follow-up manner to not block slot creation
        // although here it's fine to wait since it's an admin action.
        await fillSlotFromWaitlist(newSlot.id);
    } catch (e) {
        console.error('[Admin-Create-WaitlistFill] Failed silently:', e.message);
    }

    return newSlot;
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
    const updatedSlot = res.rows[0];

    // Trigger waitlist filling if capacity increased
    if (max_capacity !== undefined && max_capacity > currentSlot.booked_count) {
        try {
            const { fillSlotFromWaitlist } = require('./reassignment.service');
            await fillSlotFromWaitlist(updatedSlot.id);
        } catch (e) {
            console.error('[Admin-Update-WaitlistFill] Failed silently:', e.message);
        }
    }

    return updatedSlot;
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
    const { page = 1, limit = 10, status, search, resourceId, date } = queryParams;
    const offset = (page - 1) * limit;

    const apptCols = await getColumnNames('appointments');
    const hasCustomerName = apptCols.includes('customer_name');
    const hasCustomerPhone = apptCols.includes('customer_phone');
    const hasTokenNumber = apptCols.includes('token_number');
    const hasQueueNumber = apptCols.includes('queue_number');
    const hasCancelledBy = apptCols.includes('cancelled_by');
    const hasIsDeletedPerf = apptCols.includes('is_deleted_permanent');

    let queryText = `
        SELECT 
            a.id, a.org_id, a.user_id, a.service_id, a.resource_id, a.slot_id,
            a.status, a.payment_status, a.price, a.razorpay_refund_id,
            ${hasCancelledBy ? 'a.cancelled_by,' : "NULL as cancelled_by,"}
            a.created_at, 
            ${hasTokenNumber ? 'a.token_number,' : "NULL as token_number,"}
            ${hasQueueNumber ? 'a.queue_number,' : "NULL as queue_number,"}
            COALESCE(u.name, ${hasCustomerName ? 'a.customer_name' : 'NULL'}, 'Guest') as user_name, 
            COALESCE(u.email, 'Walk-in') as user_email, 
            COALESCE(u.phone, ${hasCustomerPhone ? 'a.customer_phone' : 'NULL'}, 'Not Provided') as user_phone,
            s.start_time, 
            s.end_time,
            svc.name as service_name,
            r.name as resource_name,
            a.preferred_date,
            a.reschedule_status,
            a.reschedule_reason,
            a.proposed_slot_id,
            COALESCE(loyalty.completed_count, 0) as completed_count
        FROM appointments a
        LEFT JOIN (
            SELECT user_id, COUNT(*) as completed_count
            FROM appointments
            WHERE org_id = $1 AND status = 'completed'
            GROUP BY user_id
        ) loyalty ON a.user_id = loyalty.user_id
        LEFT JOIN users u ON a.user_id = u.id
        LEFT JOIN slots s ON a.slot_id = s.id
        LEFT JOIN services svc ON a.service_id = svc.id
        LEFT JOIN resources r ON a.resource_id = r.id
        WHERE a.org_id = $1 
        ${hasIsDeletedPerf ? 'AND (a.is_deleted_permanent IS FALSE OR a.is_deleted_permanent IS NULL)' : ''}
    `;
    const params = [orgId];
    let paramCount = 1;

    if (status) {
        paramCount++;
        if (status === 'reschedule_proposed') {
            queryText += ` AND a.reschedule_status = 'pending'`;
        } else {
            queryText += ` AND a.status = $${paramCount}`;
        }
        params.push(status);
    }

    if (resourceId) {
        paramCount++;
        queryText += ` AND a.resource_id = $${paramCount}`;
        params.push(resourceId);
    }

    if (date) {
        paramCount++;
        // Use DATE() to compare only the date part of start_time (if slot exists) or created_at (if waitlist)
        queryText += ` AND (
            (a.slot_id IS NOT NULL AND DATE(s.start_time) = $${paramCount}) OR
            (a.slot_id IS NULL AND (a.preferred_date = $${paramCount} OR (a.preferred_date IS NULL AND DATE(a.created_at) = $${paramCount})))
        )`;
        params.push(date);
    }

    if (search) {
        paramCount++;
        const searchParts = [`u.name ILIKE $${paramCount}`, `u.email ILIKE $${paramCount}`];
        if (hasCustomerName) searchParts.push(`a.customer_name ILIKE $${paramCount}`);
        if (hasCustomerPhone) searchParts.push(`a.customer_phone ILIKE $${paramCount}`);
        if (hasTokenNumber) searchParts.push(`CAST(a.token_number AS TEXT) ILIKE $${paramCount}`);

        queryText += ` AND (${searchParts.join(' OR ')})`;
        params.push(`%${search}%`);
    }

    queryText += ` ORDER BY a.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    try {
        const res = await query(queryText, params);

        // Get total count for pagination (with same filters)
        let countQuery = `SELECT COUNT(*) FROM appointments a LEFT JOIN users u ON a.user_id = u.id LEFT JOIN slots s ON a.slot_id = s.id WHERE a.org_id = $1 ${hasIsDeletedPerf ? 'AND (a.is_deleted_permanent IS FALSE OR a.is_deleted_permanent IS NULL)' : ''}`;
        const countParams = [orgId];
        let countParamCount = 1;

        if (status) {
            countParamCount++;
            if (status === 'reschedule_proposed') {
                countQuery += ` AND a.reschedule_status = 'pending'`;
            } else {
                countQuery += ` AND a.status = $${countParamCount}`;
            }
            countParams.push(status);
        }

        if (resourceId) {
            countParamCount++;
            countQuery += ` AND a.resource_id = $${countParamCount}`;
            countParams.push(resourceId);
        }

        if (date) {
            countParamCount++;
        countQuery += ` AND (
            (a.slot_id IS NOT NULL AND DATE(s.start_time) = $${countParamCount}) OR
            (a.slot_id IS NULL AND (a.preferred_date = $${countParamCount} OR (a.preferred_date IS NULL AND DATE(a.created_at) = $${countParamCount})))
        )`;
        countParams.push(date);
        }

        if (search) {
            countParamCount++;
            const countSearchParts = [`u.name ILIKE $${countParamCount}`, `u.email ILIKE $${countParamCount}`];
            if (hasCustomerName) countSearchParts.push(`a.customer_name ILIKE $${countParamCount}`);
            if (hasTokenNumber) countSearchParts.push(`CAST(a.token_number AS TEXT) ILIKE $${countParamCount}`);
            
            countQuery += ` AND (${countSearchParts.join(' OR ')})`;
            countParams.push(`%${search}%`);
        }

        const countRes = await query(countQuery, countParams);

        const formattedAppointments = res.rows.map(apt => {
            let displayToken = apt.token_number;
            if (!displayToken) {
                const dateStr = new Date(apt.created_at).toISOString().slice(0, 10).replace(/-/g, '');
                const suffix = apt.id.slice(-3).toUpperCase();
                displayToken = `${dateStr}-${suffix}`;
            }
            return { ...apt, display_token: displayToken };
        });

        return {
            appointments: formattedAppointments,
            total: parseInt(countRes.rows[0].count),
            page: parseInt(page),
            limit: parseInt(limit)
        };
    } catch (e) {
        console.error('[Admin-GetAppointments] Error:', e);
        throw e;
    }
};

const updateAppointmentStatus = async (orgId, appointmentId, status, reason = null, slotId = null) => {
    // 1. Direct Reschedule / Force Move
    if (slotId) {
        const appointmentModel = require('../models/appointment.model');
        const result = await appointmentModel.rescheduleAppointment(appointmentId, null, slotId, true, orgId);
        
        if (result.appointment.slot_id) {
            const { checkAndNotifySlotWaiters } = require('./appointment.service');
            checkAndNotifySlotWaiters(result.appointment.slot_id).catch(err => console.error(`[Admin-ForceMove-Notify] Error:`, err));
        }
        
        return result.appointment;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const check = await client.query('SELECT id, slot_id, status, user_id, service_id, resource_id, payment_status FROM appointments WHERE id = $1 AND org_id = $2', [appointmentId, orgId]);
        if (check.rows.length === 0) throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');

        const appointment = check.rows[0];

        // --- PAYMENT SECURITY CHECK ---
        const priceRes = await client.query('SELECT price FROM resource_services WHERE resource_id = $1 AND service_id = $2', [appointment.resource_id, appointment.service_id]);
        const price = parseFloat(priceRes.rows[0]?.price || 0);
        
        // Only require OTP verification if the appointment was actually paid online and funds are in escrow.
        // Walk-in or offline paid appointments can be directly marked as completed by the admin.
        if (status === 'completed' && appointment.payment_status === 'paid' && price > 0) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Online paid appointments must be verified via OTP to release escrow funds.');
        }

        const apptCols = await getColumnNames('appointments');
        const hasCancelledBy = apptCols.includes('cancelled_by');
        const hasCancellationReason = apptCols.includes('cancellation_reason');

        let updateQuery = `UPDATE appointments SET status = $1, updated_at = NOW()`;
        const updateParams = [status, appointmentId];

        if (status === 'serving') {
            updateQuery = `UPDATE appointments SET status = $1, serving_started_at = NOW(), updated_at = NOW()`;
        } else if (status === 'completed') {
            updateQuery = `UPDATE appointments SET status = $1, completed_at = NOW(), updated_at = NOW()`;
        } else if (status === 'cancelled') {
            let cancelSet = `status = $1`;
            if (hasCancelledBy) cancelSet += `, cancelled_by = 'admin'`;
            if (hasCancellationReason) {
                cancelSet += `, cancellation_reason = $3`;
                updateParams.push(reason);
            }
            updateQuery = `UPDATE appointments SET ${cancelSet}, updated_at = NOW()`;
        }

        // 10. Persist the status change
        const res = await client.query(`${updateQuery} WHERE id = $2 RETURNING *`, updateParams);
        const updatedAppointment = res.rows[0];

        // 11. Decrement booked count if cancelling
        if (status === 'cancelled' && appointment.status !== 'cancelled') {
            await client.query('UPDATE slots SET booked_count = GREATEST(booked_count - 1, 0) WHERE id = $1', [appointment.slot_id]);
        }

        await client.query('COMMIT');

        // --- POST-COMMIT ACTIONS ---
        // 12. Async/Tolerant Refund logic
        if (status === 'cancelled' && appointment.status !== 'cancelled') {
            if (appointment.payment_status === 'paid' && price > 0) {
                console.log(`[Admin-Cancel-Refund] Triggering 100% refund for Appointment ${appointmentId}, Price: ${price}`);
                // Use autoRefundService to handle both Razorpay and Wallet
                // Calling AFTER commit to ensure processRefund (new connection) can see the changes and avoid deadlocks
                autoRefundService.processRefund(appointmentId, 'admin')
                    .then(result => console.log(`[Admin-Cancel-Refund] Success:`, result))
                    .catch(err => console.error(`[Admin-Cancel-Refund] FAILED:`, err.message));
            }
        }

        // --- POST-COMMIT ACTIONS ---
        // Real-time update
        try {
            socket.emitQueueUpdate({
                orgId,
                serviceId: updatedAppointment.service_id,
                resourceId: updatedAppointment.resource_id,
                userId: updatedAppointment.user_id
            }, {
                type: 'status_change',
                appointmentId,
                status,
                cancelled_by: status === 'cancelled' ? 'admin' : null,
                queue_number: updatedAppointment.queue_number,
                payment_status: updatedAppointment.payment_status
            });
        } catch (socketErr) {
            console.error('[Admin-StatusUpdate-Socket] Failed silently:', socketErr.message);
        }

        // Waitlist filling
        if (['completed', 'cancelled', 'no_show'].includes(status)) {
            const reassignmentService = require('./reassignment.service');
            if (status === 'cancelled') {
                reassignmentService.fillSlotFromWaitlist(appointment.slot_id).catch(e => console.error('[Admin-WaitlistFill] Failed silently:', e.message));
            }
        }

        // Notifications
        (async () => {
            try {
                const apptCols = await getColumnNames('appointments');
                const hasTokenNumber = apptCols.includes('token_number');
                const hasCustomerName = apptCols.includes('customer_name');

                const details = await pool.query(`
                    SELECT a.id, a.status, a.user_id, a.org_id, a.service_id, a.slot_id,
                           ${hasTokenNumber ? 'a.token_number,' : 'NULL as token_number,'}
                           COALESCE(u.name, ${hasCustomerName ? 'a.customer_name' : 'NULL'}, 'Guest') as user_name, 
                           COALESCE(u.email, 'Walk-in') as user_email,
                           u.email_notification_enabled, u.notification_enabled,
                           o.name as org_name, s.name as service_name
                    FROM appointments a
                    LEFT JOIN users u ON a.user_id = u.id
                    LEFT JOIN organizations o ON a.org_id = o.id
                    LEFT JOIN services s ON a.service_id = s.id
                    WHERE a.id = $1
                `, [appointmentId]);
                const data = details.rows[0];

                if (data && data.user_email && data.email_notification_enabled !== false) {
                     emailService.sendStatusUpdateEmail(data.user_email, data).catch(e => console.error('[Email-Async] User email failed:', e.message));
                }

                if (data && data.notification_enabled !== false) {
                     notificationService.sendNotification(
                        data.user_id,
                        'Appointment Status Updated',
                        `Your appointment for ${data.service_name} status: ${status.toUpperCase()}.`,
                        'appointment',
                        `/appointments`
                    ).catch(e => console.error('[Notify-Async] User notification failed:', e.message));
                }
            } catch (e) { console.error('[Async-Notify] Error:', e.message); }
        })();

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

        // 1. Get current appointment state
        const check = await client.query('SELECT id, slot_id, status, user_id, service_id, resource_id, payment_status FROM appointments WHERE id = $1 AND org_id = $2', [appointmentId, orgId]);
        if (check.rows.length === 0) throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');

        const appointment = check.rows[0];

        // 2. If NOT already cancelled, perform cancellation logic (slot release + refund)
        if (appointment.status !== 'cancelled') {
            // Decrease slot's booked_count if confirmed/pending
            if (appointment.status === 'confirmed' || appointment.status === 'pending') {
                if (appointment.slot_id) {
                    await client.query('UPDATE slots SET booked_count = GREATEST(booked_count - 1, 0) WHERE id = $1', [appointment.slot_id]);
                }
            }

            // Trigger refund logic for online paid appointments
            const priceRes = await client.query('SELECT price FROM resource_services WHERE resource_id = $1 AND service_id = $2', [appointment.resource_id, appointment.service_id]);
            const price = parseFloat(priceRes.rows[0]?.price || 0);

            if (appointment.payment_status === 'paid' && price > 0) {
                console.log(`[Admin-DirectDelete-Refund] Triggering auto-refund for Appointment ${appointmentId}`);
                autoRefundService.processRefund(appointmentId, 'admin').catch(err => console.error(`[Admin-DirectDelete-Refund] Refund FAILED:`, err.message));
            }
        }

        // 3. Mark as BOTH cancelled and PERMANENTLY DELETED in one step
        const res = await client.query(
            `UPDATE appointments 
             SET status = 'cancelled', 
                 cancelled_by = 'admin', 
                 cancellation_reason = COALESCE($3, cancellation_reason), 
                 deleted_at = COALESCE(deleted_at, NOW()),
                 is_deleted_permanent = TRUE,
                 updated_at = NOW()
             WHERE id = $1 AND org_id = $2 
             RETURNING *`,
            [appointmentId, orgId, reason]
        );
        const finalizedAppt = res.rows[0];

        await client.query('COMMIT');

        // 4. Post-commit: Fill slot from waitlist if needed
        if (appointment.status !== 'cancelled' && appointment.slot_id) {
            const reassignmentService = require('./reassignment.service');
            reassignmentService.fillSlotFromWaitlist(appointment.slot_id).catch(e => console.error('[Admin-DirectDelete-WaitlistFill] Failed silently:', e.message));
        }

        // 5. Post-commit socket emit
        try {
            socket.emitQueueUpdate({
                orgId,
                appointmentId,
                userId: appointment.user_id
            }, {
                type: 'permanent_delete',
                appointmentId,
                status: 'cancelled',
                cancelled_by: 'admin'
            });
        } catch (e) { console.error('Socket emit failed:', e.message); }

        return finalizedAppt;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const getLiveQueue = async (orgId, date) => {
    let queryDate = date;
    if (!queryDate) {
        try {
            queryDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
        } catch (e) {
            queryDate = new Date().toISOString().split('T')[0];
        }
    }

    const apptCols = await getColumnNames('appointments');
    const hasTokenNumber = apptCols.includes('token_number');
    const hasCustomerName = apptCols.includes('customer_name');
    const hasCustomerPhone = apptCols.includes('customer_phone');

    const appointmentsRes = await pool.query(
        `SELECT
            a.id, a.org_id,
            a.user_id,
            a.status,
            a.payment_status,
            a.price,
            a.created_at,
            ${hasTokenNumber ? 'a.token_number,' : "NULL as token_number,"}
            a.service_id,
            a.resource_id,
            a.slot_id,
            sl.start_time as slot_start,
            sl.end_time as slot_end,
            COALESCE(u.name, ${hasCustomerName ? 'a.customer_name' : 'NULL'}, 'Guest') as user_name,
            COALESCE(u.email, 'Walk-in') as user_email,
            COALESCE(u.phone, ${hasCustomerPhone ? 'a.customer_phone' : 'NULL'}, 'Not Provided') as user_phone,
            s.name as service_name,
            s.queue_scope,
            r.name as resource_name,
            ROW_NUMBER() OVER (
                PARTITION BY (
                    CASE 
                        WHEN s.queue_scope = 'PER_RESOURCE' THEN CONCAT(a.resource_id::text, '_', a.slot_id::text)
                        ELSE CONCAT(a.service_id::text, '_', a.slot_id::text)
                    END
                )
                ORDER BY COALESCE(sl.start_time, a.created_at) ASC, a.created_at ASC
            ) as queue_number
         FROM appointments a
         LEFT JOIN users u ON a.user_id = u.id
         JOIN services s ON a.service_id = s.id
         LEFT JOIN resources r ON a.resource_id = r.id
         LEFT JOIN slots sl ON a.slot_id = sl.id
         WHERE a.org_id = $1::uuid
         AND (
             (a.slot_id IS NOT NULL AND sl.start_time >= $2::date AND sl.start_time < $2::date + interval '1 day')
             -- Use preferred_date for pending/waitlisted, or fallback to created_at if preferred_date is null
             OR (a.slot_id IS NULL AND COALESCE(a.preferred_date, a.created_at::date) = $2::date)
         )
         AND a.status IN ('pending', 'confirmed', 'serving', 'completed', 'no_show', 'waitlisted_urgent')
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

const createManualAppointment = async (orgId, appointmentData) => {
    const appointmentModel = require('../models/appointment.model');
    console.log('[createManualAppointment] Incoming Data:', JSON.stringify(appointmentData, null, 2));
    
    // Generate a short numeric OR alphanumeric token (e.g., W-123)
    if (!appointmentData.token_number) {
        const rand = Math.floor(100 + Math.random() * 899); // 3 digits
        appointmentData.token_number = `W-${rand}`;
    }

    const result = await appointmentModel.createAppointment({
        ...appointmentData,
        orgId,
        bypassDuplicate: true // Manual entries by admin bypass duplicate checks
    });

    return result;
};

const getNotifications = async (userId) => {
    // Fetch notifications from the actual notifications table for THIS user (the admin)
    // Only fetch notifications intended for the admin dashboard (starting with /admin/)
    const res = await pool.query(
        `SELECT id, title, message, created_at as time, is_read, type, link
         FROM notifications 
         WHERE user_id = $1 AND link LIKE '/admin/%'
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
        const apptCols = await getColumnNames('appointments');
        const hasTokenNumber = apptCols.includes('token_number');
        
        const searchConditions = [`u.name ILIKE $2`, `u.email ILIKE $2`];
        if (hasTokenNumber) {
            searchConditions.push(`CAST(a.token_number AS TEXT) ILIKE $2`);
        }

        const appointmentsPromise = client.query(
            `SELECT a.id, a.org_id, a.service_id, a.resource_id, a.slot_id, ${hasTokenNumber ? 'a.token_number,' : 'NULL as token_number,'} a.status, a.created_at, 
                    u.name as patient_name, u.email as patient_email
             FROM appointments a
            LEFT JOIN users u ON a.user_id = u.id
             WHERE a.org_id = $1 
               AND (${searchConditions.join(' OR ')})
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


const getPredictiveInsights = async (orgId) => {
    try {
        // 1. Calculate Average Service Duration (last 30 days)
        const avgDurationRes = await query(`
            SELECT 
                a.service_id,
                a.resource_id,
                svc.name as service_name,
                r.name as resource_name,
                AVG(EXTRACT(EPOCH FROM (a.completed_at - a.serving_started_at)) / 60) as avg_duration_minutes,
                COUNT(*) as completion_count
            FROM appointments a
            JOIN services svc ON a.service_id = svc.id
            LEFT JOIN resources r ON a.resource_id = r.id
            WHERE a.org_id = $1::uuid 
            AND a.status = 'completed'
            AND a.serving_started_at IS NOT NULL 
            AND a.completed_at IS NOT NULL
            AND a.completed_at > NOW() - interval '30 days'
            GROUP BY a.service_id, a.resource_id, svc.name, r.name
        `, [orgId]);

        // 2. Resource Efficiency (Efficiency vs Service Average)
        const resourceEfficiency = avgDurationRes.rows.map(row => {
            const serviceAvg = avgDurationRes.rows
                .filter(r => r.service_id === row.service_id)
                .reduce((acc, r, _, arr) => acc + (parseFloat(r.avg_duration_minutes) / arr.length), 0);
            
            const duration = parseFloat(row.avg_duration_minutes);
            const efficiency = (serviceAvg > 0 && duration > 0) ? (serviceAvg / duration) : 1;
            const efficiency_score = Math.min(Math.round(efficiency * 100), 200); // Cap at 200% for sanity
            return {
                resource_name: row.resource_name || 'Unassigned',
                service_name: row.service_name,
                avg_time: Math.round(parseFloat(row.avg_duration_minutes)),
                efficiency_score: efficiency_score,
                completions: parseInt(row.completion_count)
            };
        });

        // 3. Peak Hour Loads (Based on actual service start times)
        const peakHoursRes = await query(`
            SELECT 
                EXTRACT(HOUR FROM serving_started_at) as hour,
                COUNT(*) as volume
            FROM appointments
            WHERE org_id = $1::uuid 
            AND status = 'completed'
            AND serving_started_at IS NOT NULL
            AND serving_started_at > NOW() - interval '30 days'
            GROUP BY hour
            ORDER BY volume DESC
            LIMIT 3
        `, [orgId]);

        // 4. Smart Wait Time Model (Current Queues)
        const currentQueues = await getLiveQueue(orgId);
        const waitTimePredictions = currentQueues.map(q => {
            const waitingCount = q.appointments.filter(a => a.status === 'confirmed' || a.status === 'pending').length;
            
            // Find specific average for this resource/service
            const stats = avgDurationRes.rows.find(r => 
                r.service_id === q.service_id && (q.resource_id ? r.resource_id === q.resource_id : true)
            );
            
            const avgMins = stats ? parseFloat(stats.avg_duration_minutes) : 15; // fallback to 15m
            const predictedWait = waitingCount * avgMins;

            return {
                queue_name: q.resource_name || q.name,
                waiting_count: waitingCount,
                avg_service_time: Math.round(avgMins),
                predicted_total_wait: Math.round(predictedWait),
                confidence: stats ? (parseInt(stats.completion_count) > 10 ? 'High' : 'Medium') : 'Low'
            };
        });

        return {
            averageDurations: avgDurationRes.rows.map(r => ({
                service: r.service_name,
                resource: r.resource_name,
                minutes: Math.round(parseFloat(r.avg_duration_minutes))
            })),
            resourceEfficiency,
            peakHours: peakHoursRes.rows,
            currentPredictions: waitTimePredictions,
            lastAnalysis: new Date().toISOString()
        };
    } catch (error) {
        console.error('getPredictiveInsights error:', error);
        throw error;
    }
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

/**
 * Get User Loyalty Metrics
 */
const getUserLoyalty = async (orgId, userId) => {
    if (!userId) return null;

    const res = await query(`
        SELECT 
            COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
            MAX(completed_at) as last_visit,
            COUNT(*) FILTER (WHERE status = 'cancelled' AND cancelled_by = 'user') as user_cancellation_count
        FROM appointments 
        WHERE org_id = $1 AND user_id = $2
    `, [orgId, userId]);

    const metrics = res.rows[0];
    const visitCount = parseInt(metrics.completed_count) || 0;

    return {
        visitCount,
        lastVisit: metrics.last_visit,
        userCancellationCount: parseInt(metrics.user_cancellation_count) || 0,
        isFrequentVisitor: visitCount >= 3,
        loyaltyTier: visitCount >= 10 ? 'Diamond' : (visitCount >= 5 ? 'Gold' : (visitCount >= 3 ? 'Silver' : (visitCount >= 1 ? 'Bronze' : 'None')))
    };
};

/**
 * Get Detailed User Appointment History
 */
const getUserHistory = async (orgId, userId) => {
    if (!userId) return [];

    const res = await query(`
        SELECT 
            a.id, a.status, a.created_at, a.completed_at, a.preferred_date, a.admin_remarks,
            s.name as service_name,
            r.name as resource_name,
            sl.start_time, sl.end_time,
            rv.rating as review_rating,
            rv.comment as review_comment
        FROM appointments a
        LEFT JOIN services s ON a.service_id = s.id
        LEFT JOIN resources r ON a.resource_id = r.id
        LEFT JOIN slots sl ON a.slot_id = sl.id
        LEFT JOIN reviews rv ON a.id = rv.appointment_id
        WHERE a.org_id = $1 AND a.user_id = $2
        ORDER BY a.created_at DESC
    `, [orgId, userId]);

    return res.rows;
};

/**
 * Retry a failed refund
 */
const retryRefund = async (orgId, appointmentId) => {
    const autoRefundService = require('./autoRefund.service');
    const res = await query(
        'SELECT id, status, payment_status, org_id FROM appointments WHERE id = $1 AND org_id = $2',
        [appointmentId, orgId]
    );
    
    if (res.rows.length === 0) throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');
    const apt = res.rows[0];

    if (apt.payment_status !== 'refund_failed') {
        throw new ApiError(httpStatus.BAD_REQUEST, 'This appointment is not in a failed refund state');
    }

    console.log(`[Admin-RetryRefund] Retrying refund for appt: ${appointmentId}`);
    return await autoRefundService.processRefund(appointmentId, 'admin');
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
    deleteOrganization,
    getPredictiveInsights,
    createManualAppointment,
    getUserLoyalty,
    getUserHistory,
    retryRefund
};

