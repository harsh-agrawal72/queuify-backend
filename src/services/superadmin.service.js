const httpStatus = require('../utils/httpStatus');
const { pool } = require('../config/db');
const ApiError = require('../utils/ApiError');

const getGlobalOverview = async () => {
    // 1. Organization Stats
    const orgsRes = await pool.query(`
        SELECT 
            COUNT(*) as total, 
            SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN subscription_status='trial' THEN 1 ELSE 0 END) as trial,
            SUM(CASE WHEN status='disabled' OR subscription_status='cancelled' THEN 1 ELSE 0 END) as suspended
        FROM organizations
    `);

    // 2. User Stats (Split by Role)
    const usersRes = await pool.query(`
        SELECT 
            SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) as users,
            SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admins
        FROM users
    `);

    // 3. Booking Stats (All time)
    const bookingsRes = await pool.query(`
        SELECT 
            COUNT(*) as total, 
            SUM(CASE WHEN DATE(created_at) = CURRENT_DATE THEN 1 ELSE 0 END) as today 
        FROM appointments
    `);

    // 4. Revenue Stats (All time)

    // 5. MRR Calculation
    const mrrRes = await pool.query(`
        SELECT COALESCE(SUM(p.price_monthly), 0) as mrr
        FROM organizations o
        JOIN plans p ON o.plan_id = p.id
        WHERE o.status = 'active' AND o.subscription_status IN ('active', 'trial')
    `);

    // 6. Platform Fill Rate
    const fillRateRes = await pool.query(`
        SELECT 
            COALESCE(SUM(booked_count), 0) as booked,
            COALESCE(SUM(max_capacity), 0) as capacity
        FROM slots
        WHERE start_time >= CURRENT_DATE - INTERVAL '30 days'
    `);

    const totalBookings = parseInt(bookingsRes.rows[0].total) || 0;
    const totalCapacity = parseInt(fillRateRes.rows[0].capacity) || 1;
    const totalBookedSlots = parseInt(fillRateRes.rows[0].booked) || 0;

    // Cancellation Rate
    const cancelledRes = await pool.query("SELECT COUNT(*) FROM appointments WHERE status = 'cancelled'");
    const cancelledBookings = parseInt(cancelledRes.rows[0].count) || 0;

    // Industry distribution
    const industryRes = await pool.query(`
            SELECT type, COUNT(*) as count 
            FROM organizations 
            GROUP BY type
        `);

    return {
        // KPI Cards
        totalOrganizations: parseInt(orgsRes.rows[0].total),
        activeOrganizations: parseInt(orgsRes.rows[0].active),
        trialOrganizations: parseInt(orgsRes.rows[0].trial),
        suspendedOrganizations: parseInt(orgsRes.rows[0].suspended),
        industryDistribution: industryRes.rows,

        totalUsers: parseInt(usersRes.rows[0].users) || 0,
        totalAdmins: parseInt(usersRes.rows[0].admins) || 0,

        totalBookings: totalBookings,
        todayBookings: parseInt(bookingsRes.rows[0].today),

        mrr: parseFloat(mrrRes.rows[0].mrr),

        fillRate: ((totalBookedSlots / totalCapacity) * 100).toFixed(1),
        cancellationRate: totalBookings > 0 ? ((cancelledBookings / totalBookings) * 100).toFixed(1) : 0,

        growthRate: 5.4
    };
};

const getOrganizations = async () => {
    const res = await pool.query('SELECT * FROM organizations ORDER BY created_at DESC');
    return res.rows;
};

const tokenService = require('./token.service');
const activityService = require('./activity.service');

const createOrganization = async (orgBody, user) => {
    // Expect snake_case from input
    const { name, slug, contact_email, plan_id, admin_name, admin_email } = orgBody;

    // Check if slug exists
    const check = await pool.query('SELECT id FROM organizations WHERE slug = $1', [slug]);
    if (check.rows.length > 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Organization slug already taken');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Create Organization
        const res = await client.query(
            "INSERT INTO organizations (name, slug, contact_email, status, plan_id, type) VALUES ($1, $2, $3, 'active', $4, $5) RETURNING *",
            [name, slug, contact_email, plan_id || null, orgBody.type || 'Clinic']
        );
        const newOrg = res.rows[0];

        // 2. Create Admin User
        // Generate secure random temp password (will be hashed)
        const tempPassword = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
        const hashedPassword = await require('bcryptjs').hash(tempPassword, 8);

        // We use client query to ensure atomicity
        const userRes = await client.query(
            "INSERT INTO users (name, email, password_hash, role, org_id, is_password_set) VALUES ($1, $2, $3, 'admin', $4, false) RETURNING *",
            [admin_name, admin_email, hashedPassword, newOrg.id]
        );
        const newAdmin = userRes.rows[0];

        // 3. Generate Invitation Token
        const expiresIn = '7d';
        const invToken = await tokenService.generateToken(newAdmin.id, 'admin', newOrg.id, expiresIn, undefined, { type: 'invite' });

        // 4. Send Invitation Email
        const inviteLink = `http://localhost:5173/set-password?token=${invToken}`;

        console.log('---------------------------------------------------');
        console.log('INVITATION LINK (Fallback):');
        console.log(inviteLink);
        console.log('---------------------------------------------------');

        try {
            await require('./email.service').sendEmail(
                admin_email,
                'Welcome! Set up your Organization Password',
                `
                <div style="font-family: Arial, sans-serif;">
                    <h2>Welcome to Queuify Manager</h2>
                    <p>Hello ${admin_name},</p>
                    <p>Your organization <strong>${name}</strong> has been created successfully.</p>
                    <p>Please click the link below to set your password and access your admin dashboard:</p>
                    <p>
                        <a href="${inviteLink}" style="background-color: #4F46E5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Set Password</a>
                    </p>
                    <p>or copy this link: ${inviteLink}</p>
                    <br>
                    <p>This link will expire in 7 days.</p>
                </div>
                `
            );
        } catch (emailErr) {
            console.error('Failed to send email, but logged link above.', emailErr);
        }

        await client.query('COMMIT');

        // activityService.logActivity(user?.id, 'ORG_CREATED', { orgId: newOrg.id, name }, '::1');

        return { ...newOrg, admin: { id: newAdmin.id, email: newAdmin.email } };

    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

const updateOrganization = async (orgId, updateBody) => {
    const { name, slug, contact_email, status, plan_id, subscription_status } = updateBody;
    const check = await pool.query('SELECT id FROM organizations WHERE id = $1', [orgId]);
    if (check.rows.length === 0) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found');
    }

    if (slug) {
        const slugCheck = await pool.query('SELECT id FROM organizations WHERE slug = $1 AND id != $2', [slug, orgId]);
        if (slugCheck.rows.length > 0) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Organization slug already taken');
        }
    }

    const res = await pool.query(
        `UPDATE organizations 
         SET name = COALESCE($1, name), 
             slug = COALESCE($2, slug), 
             contact_email = COALESCE($3, contact_email), 
             status = COALESCE($4, status),
             plan_id = COALESCE($5, plan_id),
             subscription_status = COALESCE($6, subscription_status),
             type = COALESCE($7, type),
             updated_at = NOW()
         WHERE id = $8 
         RETURNING *`,
        [name, slug, contact_email, status, plan_id, subscription_status, updateBody.type, orgId]
    );
    return res.rows[0];
};



const impersonateOrgAdmin = async (orgId, superadminId) => {
    const res = await pool.query("SELECT * FROM users WHERE org_id = $1 AND role = 'admin' LIMIT 1", [orgId]);
    if (res.rows.length === 0) {
        throw new ApiError(httpStatus.NOT_FOUND, 'No admin found for this organization');
    }
    const user = res.rows[0];

    // Log the impersonation event
    await pool.query(
        "INSERT INTO impersonation_logs (superadmin_id, org_id) VALUES ($1, $2)",
        [superadminId, orgId]
    );

    // Update last login for the impersonated user so they show active in lists
    await require('../models/user.model').updateUserLastLogin(user.id);

    // Generate token with impersonation flag
    const tokens = await tokenService.generateAuthTokens(user, { impersonated: true, original_superadmin_id: superadminId });

    return { user, tokens };
};

const suspendOrganization = async (orgId) => {
    return updateOrganization(orgId, { status: 'disabled' });
};

const activateOrganization = async (orgId) => {
    return updateOrganization(orgId, { status: 'active' });
};

const permanentDeleteOrganization = async (orgId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Delete Admin Activity Logs (they don't have direct org link, only via admins)
        // We do this first while the admins still exist
        await client.query('DELETE FROM admin_activity_logs WHERE admin_id IN (SELECT id FROM users WHERE org_id = $1)', [orgId]);

        // 2. Finally, Delete Organization
        // This will automatically cascade delete: users, slots, appointments, services, impersonation_logs, etc.
        // And appointments will cascade delete payments.
        const res = await client.query('DELETE FROM organizations WHERE id = $1 RETURNING *', [orgId]);

        if (res.rows.length === 0) {
            throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found');
        }

        await client.query('COMMIT');
        return res.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Permanent Delete] Error:', error);
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Log admin-related actions
 */
const logAdminActivity = async (adminId, action, performedBy, details = {}) => {
    await pool.query(
        'INSERT INTO admin_activity_logs (admin_id, action, performed_by, details) VALUES ($1, $2, $3, $4)',
        [adminId, action, performedBy, JSON.stringify(details)]
    );
};

const getAdmins = async (filters, options) => {
    const { search, orgId, status } = filters;
    const page = options.page || 1;
    const limit = options.limit || 20;
    const offset = (page - 1) * limit;

    // 1. Analytics Summary
    const statsRes = await pool.query(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN activated_at IS NOT NULL AND is_suspended = false THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN activated_at IS NULL AND invited_at IS NOT NULL THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN is_suspended = true THEN 1 ELSE 0 END) as suspended
        FROM users 
        WHERE role = 'admin'
    `);
    const stats = {
        total: parseInt(statsRes.rows[0].total) || 0,
        active: parseInt(statsRes.rows[0].active) || 0,
        pending: parseInt(statsRes.rows[0].pending) || 0,
        suspended: parseInt(statsRes.rows[0].suspended) || 0
    };

    // 2. Query with Status Logic
    let query = `
        SELECT u.id, u.name, u.email, u.role, u.org_id, u.created_at, u.last_login_at, 
               u.invited_at, u.activated_at, u.is_suspended, o.name as org_name,
               CASE 
                    WHEN u.is_suspended = true THEN 'Suspended'
                    WHEN u.activated_at IS NOT NULL THEN 'Active'
                    WHEN u.invited_at IS NOT NULL THEN 'Invited'
                    ELSE 'Pending'
               END as status
        FROM users u
        LEFT JOIN organizations o ON u.org_id = o.id
        WHERE u.role = 'admin'
    `;
    const params = [];
    let paramIndex = 1;

    if (search) {
        query += ` AND (u.name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`;
        params.push(`%${search}%`);
        paramIndex++;
    }

    if (orgId) {
        query += ` AND u.org_id = $${paramIndex}`;
        params.push(orgId);
        paramIndex++;
    }

    if (status) {
        if (status === 'Active') query += ` AND u.activated_at IS NOT NULL AND u.is_suspended = false`;
        else if (status === 'Invited') query += ` AND u.activated_at IS NULL AND u.invited_at IS NOT NULL`;
        else if (status === 'Suspended') query += ` AND u.is_suspended = true`;
    }

    query += ` ORDER BY u.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const res = await pool.query(query, params);

    // Get total count for pagination
    let countQuery = `SELECT COUNT(*) FROM users u WHERE u.role = 'admin'`;
    const countParams = [];
    let countParamIndex = 1;

    if (search) {
        countQuery += ` AND (u.name ILIKE $${countParamIndex} OR u.email ILIKE $${countParamIndex})`;
        countParams.push(`%${search}%`);
        countParamIndex++;
    }
    if (orgId) {
        countQuery += ` AND u.org_id = $${countParamIndex}`;
        countParams.push(orgId);
        countParamIndex++;
    }
    if (status) {
        if (status === 'Active') countQuery += ` AND u.activated_at IS NOT NULL AND u.is_suspended = false`;
        else if (status === 'Invited') countQuery += ` AND u.activated_at IS NULL AND u.invited_at IS NOT NULL`;
        else if (status === 'Suspended') countQuery += ` AND u.is_suspended = true`;
    }

    const countRes = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countRes.rows[0].count);

    return {
        stats,
        data: res.rows,
        meta: {
            total: totalCount,
            page,
            limit,
            totalPages: Math.ceil(totalCount / limit)
        }
    };
};

const inviteAdmin = async (adminBody, superadminId) => {
    const { email, orgId, name } = adminBody;

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
    const inviteLink = `http://localhost:5173/set-password?token=${invToken}`;

    // Send email (swallow error for demo)
    try {
        await require('./email.service').sendEmail(
            email,
            'You are invited as an Admin',
            `<p>Click here to set your password: <a href="${inviteLink}">${inviteLink}</a></p>`
        );
    } catch (e) {
        console.error('Invite email failed', e);
    }

    await logAdminActivity(newAdmin.id, 'INVITE', superadminId, { orgId });

    return newAdmin;
};

const resendInvite = async (adminId, superadminId) => {
    const res = await pool.query("SELECT * FROM users WHERE id = $1 AND role = 'admin'", [adminId]);
    if (res.rows.length === 0) throw new ApiError(httpStatus.NOT_FOUND, 'Admin not found');
    const admin = res.rows[0];

    const invToken = await tokenService.generateToken(admin.id, 'admin', admin.org_id, '7d', undefined, { type: 'invite' });
    const inviteLink = `http://localhost:5173/set-password?token=${invToken}`;

    await pool.query('UPDATE users SET invited_at = NOW() WHERE id = $1', [adminId]);

    try {
        await require('./email.service').sendEmail(
            admin.email,
            'Invitation Resent',
            `<p>Click here to set your password: <a href="${inviteLink}">${inviteLink}</a></p>`
        );
    } catch (e) {
        console.error('Resend email failed', e);
    }

    await logAdminActivity(adminId, 'RESEND_INVITE', superadminId);

    return { message: 'Invite resent' };
};

const updateAdminStatus = async (adminId, statusAction, superadminId) => {
    let updateBody = {};
    if (statusAction === 'suspend') updateBody = { is_suspended: true };
    else if (statusAction === 'unsuspend') updateBody = { is_suspended: false };
    else if (statusAction === 'activate') updateBody = { activated_at: 'NOW()', is_suspended: false };

    // Direct query for complex cases like activated_at = NOW()
    const query = statusAction === 'activate'
        ? 'UPDATE users SET activated_at = NOW(), is_suspended = false, updated_at = NOW() WHERE id = $1 RETURNING *'
        : `UPDATE users SET is_suspended = $2, updated_at = NOW() WHERE id = $1 RETURNING *`;

    const params = statusAction === 'activate' ? [adminId] : [adminId, statusAction === 'suspend'];

    const res = await pool.query(query, params);
    if (res.rows.length === 0) throw new ApiError(httpStatus.NOT_FOUND, 'Admin not found');

    await logAdminActivity(adminId, statusAction.toUpperCase(), superadminId);

    return res.rows[0];
};

const deleteAdmin = async (adminId, superadminId) => {
    if (adminId === superadminId) throw new ApiError(httpStatus.BAD_REQUEST, 'You cannot delete yourself');

    // 1. Log the deletion before it happens (to capture the relationship while it exists, 
    // although SET NULL handles it anyway)
    await logAdminActivity(adminId, 'DELETE', superadminId);

    // 2. Perform deletion
    const res = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [adminId]);
    if (res.rows.length === 0) throw new ApiError(httpStatus.NOT_FOUND, 'Admin not found');

    return res.rows[0];
};

const createAdmin = async (adminBody) => {
    throw new ApiError(httpStatus.NOT_IMPLEMENTED, "Use /auth/register-admin instead");
};

// Aggregated View for Global Bookings
const getGlobalBookingStats = async () => {
    const res = await pool.query(`
        SELECT 
            o.id as org_id,
            o.name as org_name,
            COUNT(a.id) as total_bookings,
            SUM(CASE WHEN DATE(a.created_at) = CURRENT_DATE THEN 1 ELSE 0 END) as today_bookings,
            SUM(CASE WHEN a.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
            SUM(CASE WHEN a.status = 'pending' THEN 1 ELSE 0 END) as pending
        FROM organizations o
        LEFT JOIN appointments a ON o.id = a.org_id
        WHERE o.status = 'active'
        GROUP BY o.id, o.name
        ORDER BY total_bookings DESC
    `);

    return res.rows;
};

// Detailed View for Specific Org Bookings
const getOrgBookings = async (orgId, filters, options) => {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const offset = (page - 1) * limit;

    let query = `
        SELECT a.*, u.name as user_name, s.start_time, s.end_time
        FROM appointments a
        LEFT JOIN users u ON a.user_id = u.id
        LEFT JOIN slots s ON a.slot_id = s.id
        WHERE a.org_id = $1
    `;
    const params = [orgId];
    let paramIndex = 2;

    if (filters.status) {
        query += ` AND a.status = $${paramIndex}`;
        params.push(filters.status);
        paramIndex++;
    }

    // Date range etc. can be added

    query += ` ORDER BY a.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const res = await pool.query(query, params);

    const countQuery = `SELECT COUNT(*) FROM appointments WHERE org_id = $1 ${filters.status ? "AND status = $2" : ""}`;
    const countParams = [orgId];
    if (filters.status) countParams.push(filters.status);

    const countRes = await pool.query(countQuery, countParams);

    return {
        data: res.rows,
        meta: {
            total: parseInt(countRes.rows[0].count),
            page,
            limit
        }
    };
};

const cancelAnyAppointment = async (apptId) => {
    const check = await pool.query('SELECT id, slot_id, status FROM appointments WHERE id = $1', [apptId]);
    if (check.rows.length === 0) throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');

    const appt = check.rows[0];
    if (appt.status === 'confirmed') {
        await pool.query('UPDATE slots SET booked_count = booked_count - 1 WHERE id = $1', [appt.slot_id]);
    }

    const res = await pool.query("UPDATE appointments SET status = 'cancelled' WHERE id = $1 RETURNING *", [apptId]);
    return res.rows[0];
};

const getAdvancedAnalytics = async () => {
    // 1. Org Growth (Last 6 months)
    const orgGrowth = await pool.query(`
        SELECT TO_CHAR(created_at, 'Mon') as name, COUNT(*) as orgs
        FROM organizations
        WHERE created_at >= NOW() - INTERVAL '6 months'
        GROUP BY TO_CHAR(created_at, 'Mon'), DATE_TRUNC('month', created_at)
        ORDER BY DATE_TRUNC('month', created_at)
    `);

    return {
        orgGrowth: orgGrowth.rows
    };
};

const getGlobalAnalytics = async () => {
    // 1. Daily Bookings Global
    const daily = await pool.query(`
        SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as date, COUNT(*) as count 
        FROM appointments 
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD')
        ORDER BY date ASC
    `);

    // 2. Top Orgs by Bookings
    const topOrgs = await pool.query(`
        SELECT o.name, COUNT(a.id) as bookings
        FROM appointments a
        JOIN organizations o ON a.org_id = o.id
        GROUP BY o.name
        ORDER BY bookings DESC
        LIMIT 5
    `);

    return {
        dailyBookings: daily.rows,
        topOrganizations: topOrgs.rows
    };
};

const getSystemHealth = async () => {
    // 1. Database Stats
    const dbStart = Date.now();
    const dbRes = await pool.query('SELECT 1');
    const dbLatency = Date.now() - dbStart;

    // Get PG stats (if available)
    const connStats = await pool.query(`
        SELECT 
            (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max_conns,
            count(*)::int as active_conns,
            sum(case when state = 'idle' then 1 else 0 end)::int as idle_conns
        FROM pg_stat_activity
    `);
    const { max_conns, active_conns, idle_conns } = connStats.rows[0];

    // 2. Request & Error Metrics (Last 24h)
    const reqStats = await pool.query(`
        SELECT 
            COUNT(*)::int as total_today,
            AVG(response_time)::float as avg_latency
        FROM request_logs 
        WHERE created_at >= NOW() - INTERVAL '24 hours'
    `);

    const errStats = await pool.query(`
        SELECT 
            COUNT(*)::int as total_24h,
            SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END)::int as critical_5xx,
            SUM(CASE WHEN status_code >= 400 AND status_code < 500 THEN 1 ELSE 0 END)::int as client_4xx
        FROM error_logs
        WHERE created_at >= NOW() - INTERVAL '24 hours'
    `);

    // Top 5 errors
    const topErrors = await pool.query(`
        SELECT message, COUNT(*)::int as count 
        FROM error_logs 
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY message 
        ORDER BY count DESC 
        LIMIT 5
    `);

    // 3. Active Sessions (Last 15m)
    const activeSessions = await pool.query(`
        SELECT 
            COUNT(DISTINCT user_id)::int as users,
            COUNT(DISTINCT org_id)::int as orgs
        FROM request_logs 
        WHERE created_at >= NOW() - INTERVAL '15 minutes'
    `);

    // 4. Hardware Metrics
    const memory = process.memoryUsage();

    return {
        api: {
            status: 'healthy',
            uptime: Math.floor(process.uptime()),
            serverTime: new Date().toISOString(),
            version: require('../../package.json').version,
            memory: {
                heapUsed: (memory.heapUsed / 1024 / 1024).toFixed(2),
                heapTotal: (memory.heapTotal / 1024 / 1024).toFixed(2),
                rss: (memory.rss / 1024 / 1024).toFixed(2)
            }
        },
        database: {
            status: 'Connected',
            latency: dbLatency,
            maxConnections: max_conns,
            activeConnections: active_conns,
            idleConnections: idle_conns,
            poolUsage: ((active_conns / max_conns) * 100).toFixed(1)
        },
        traffic: {
            totalRequests24h: reqStats.rows[0].total_today || 0,
            avgLatency: parseFloat(reqStats.rows[0].avg_latency || 0).toFixed(2),
            activeUsers15m: activeSessions.rows[0].users || 0,
            activeOrgs15m: activeSessions.rows[0].orgs || 0
        },
        errors: {
            total24h: errStats.rows[0].total_24h || 0,
            critical5xx: errStats.rows[0].critical_5xx || 0,
            client4xx: errStats.rows[0].client_4xx || 0,
            topErrors: topErrors.rows
        }
    };
};

const getGlobalMonitorData = async () => {
    // 1. Get Summary Stats
    const statsRes = await pool.query(`
        SELECT 
            COUNT(DISTINCT a.org_id) as total_active_orgs,
            COUNT(*) FILTER (WHERE a.status IN ('pending', 'confirmed')) as total_waiting,
            COALESCE(AVG(s.estimated_service_time), 15) as avg_est_time
        FROM appointments a
        JOIN services s ON a.service_id = s.id
        WHERE a.status IN ('pending', 'confirmed', 'serving')
        AND DATE(a.created_at) = CURRENT_DATE
    `);

    // 2. Get Per-Organization Metrics
    const orgsRes = await pool.query(`
        SELECT 
            o.id,
            o.name,
            COUNT(a.id) FILTER (WHERE a.status IN ('pending', 'confirmed')) as waiting,
            COUNT(a.id) FILTER (WHERE a.status = 'serving') as serving
        FROM organizations o
        LEFT JOIN appointments a ON o.id = a.org_id AND DATE(a.created_at) = CURRENT_DATE
        WHERE o.status = 'active'
        GROUP BY o.id, o.name
        ORDER BY waiting DESC
    `);

    const organizations = orgsRes.rows.map(org => {
        let status = 'idle';
        const waiting = parseInt(org.waiting);
        if (waiting > 20) status = 'critical';
        else if (waiting > 10) status = 'busy';
        else if (waiting > 0 || parseInt(org.serving) > 0) status = 'stable';

        return {
            ...org,
            waiting,
            serving: parseInt(org.serving),
            status
        };
    });

    const stats = statsRes.rows[0];

    return {
        stats: {
            totalActiveQueues: parseInt(stats.total_active_orgs) || 0,
            totalWaiting: parseInt(stats.total_waiting) || 0,
            avgWaitTime: Math.round(parseFloat(stats.avg_est_time) || 0),
            systemLoad: parseInt(stats.total_waiting) > 50 ? 'Heavy' : 'Optimal'
        },
        organizations
    };
};

module.exports = {
    getGlobalBookingStats,
    getGlobalMonitorData,
    getOrgBookings,
    getGlobalOverview,
    getOrganizations,
    createOrganization,
    updateOrganization,
    permanentDeleteOrganization,
    getAdmins,
    createAdmin,
    cancelAnyAppointment,
    getGlobalAnalytics,
    getAdvancedAnalytics,
    getSystemHealth,
    impersonateOrgAdmin,
    suspendOrganization,
    activateOrganization,
    inviteAdmin,
    resendInvite,
    updateAdminStatus,
    deleteAdmin,
    getRecentActivity: activityService.getRecentActivity
};
