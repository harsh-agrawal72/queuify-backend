const httpStatus = require('../utils/httpStatus');
const { pool } = require('../config/db');
const ApiError = require('../utils/ApiError');
const bcrypt = require('bcryptjs');
const tokenService = require('./token.service');
const activityService = require('./activity.service');
const emailService = require('./email.service');
const userModel = require('../models/user.model');
const pkg = require('../../package.json');
const cacheService = require('./cache.service');

const getGlobalOverview = async () => {
    return cacheService.getOrSet('global_overview', async () => {
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
                SUM(CASE WHEN DATE(created_at) = CURRENT_DATE THEN 1 ELSE 0 END) as today,
                SUM(CASE WHEN status = 'waitlisted_urgent' THEN 1 ELSE 0 END) as total_urgent,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as total_pending,
                SUM(CASE WHEN DATE(created_at) = CURRENT_DATE AND status = 'waitlisted_urgent' THEN 1 ELSE 0 END) as today_urgent
            FROM appointments
        `);

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
            totalUrgent: parseInt(bookingsRes.rows[0].total_urgent) || 0,
            totalPending: parseInt(bookingsRes.rows[0].total_pending) || 0,
            todayUrgent: parseInt(bookingsRes.rows[0].today_urgent) || 0,

            mrr: parseFloat(mrrRes.rows[0].mrr),

            fillRate: ((totalBookedSlots / totalCapacity) * 100).toFixed(1),
            cancellationRate: totalBookings > 0 ? ((cancelledBookings / totalBookings) * 100).toFixed(1) : 0,

            growthRate: 5.4
        };
    }, 60);
};

const getOrganizations = async () => {
    const res = await pool.query(`
        SELECT 
            o.*, 
            p.description, p.city, p.state, p.pincode, p.contact_phone as profile_phone, 
            p.contact_email as profile_email, p.website_url, p.facebook_url, 
            p.instagram_url, p.linkedin_url, p.gst_number, p.registration_number,
            p.established_year, p.total_staff, p.verified,
            (
                SELECT json_agg(json_build_object(
                    'id', i.id, 
                    'image_type', i.image_type, 
                    'mime_type', i.mime_type
                ))
                FROM organization_images i 
                WHERE i.org_id = o.id
            ) as images
        FROM organizations o
        LEFT JOIN organization_profiles p ON o.id = p.org_id
        ORDER BY o.created_at DESC
    `);
    return res.rows;
};

const verifyOrganization = async (orgId, superadminId) => {
    // Ensure profile exists
    await pool.query('INSERT INTO organization_profiles (org_id, verified) VALUES ($1, true) ON CONFLICT (org_id) DO UPDATE SET verified = true, updated_at = NOW()', [orgId]);
    const org = await pool.query('SELECT name FROM organizations WHERE id = $1', [orgId]);
    activityService.logActivity(superadminId, 'ORG_VERIFIED', { orgId, name: org.rows[0]?.name }, '::1');
    return { message: 'Organization verified successfully' };
};

const unverifyOrganization = async (orgId, superadminId) => {
    await pool.query('UPDATE organization_profiles SET verified = false, updated_at = NOW() WHERE org_id = $1', [orgId]);
    const org = await pool.query('SELECT name FROM organizations WHERE id = $1', [orgId]);
    activityService.logActivity(superadminId, 'ORG_UNVERIFIED', { orgId, name: org.rows[0]?.name }, '::1');
    return { message: 'Organization verification removed' };
};

// Mid-file requires moved to top

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
        const hashedPassword = await bcrypt.hash(tempPassword, 8);

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
        const inviteLink = `${config.clientUrl}/set-password?token=${invToken}`;

        console.log('---------------------------------------------------');
        console.log('INVITATION LINK (Fallback):');
        console.log(inviteLink);
        console.log('---------------------------------------------------');

        try {
            await emailService.sendOrgCreationEmail(admin_email, admin_name, name, inviteLink);
        } catch (emailErr) {
            console.error('Failed to send email, but logged link above.', emailErr);
        }

        await client.query('COMMIT');
 
        activityService.logActivity(user?.id, 'ORG_CREATED', { orgId: newOrg.id, name }, '::1');
 
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
    console.log(`[Impersonate] Service call: orgId=${orgId}, superadminId=${superadminId}`);
    
    const res = await pool.query("SELECT * FROM users WHERE org_id = $1 AND role = 'admin' AND is_suspended = false LIMIT 1", [orgId]);
    if (res.rows.length === 0) {
        console.warn(`[Impersonate] Failed: No active admin found for organization ${orgId}`);
        throw new ApiError(httpStatus.NOT_FOUND, 'No active admin found for this organization');
    }
    const user = res.rows[0];

    // Log the impersonation event (non-fatal if table doesn't exist)
    try {
        await pool.query(
            "INSERT INTO impersonation_logs (superadmin_id, org_id) VALUES ($1, $2)",
            [superadminId, orgId]
        );
    } catch (logErr) {
        console.warn('[Impersonate] Could not write to impersonation_logs (table may not exist):', logErr.message);
    }

    // Update last login for the impersonated user so they show active in lists
    await userModel.updateUserLastLogin(user.id);

    // 3. Log the impersonation event in official audit trail
    // We do this before token generation
    await activityService.logActivity(superadminId, 'SUPERADMIN_IMPERSONATE', { 
        targetUserId: user.id, 
        targetOrgId: orgId,
        targetEmail: user.email
    }, '::1');

    // Generate token with impersonation flag
    const tokens = await tokenService.generateAuthTokens(user, { impersonated: true, original_superadmin_id: superadminId });

    return { user, tokens };
};

const suspendOrganization = async (orgId, superadminId) => {
    const org = await updateOrganization(orgId, { status: 'disabled' });
    activityService.logActivity(superadminId, 'ORG_SUSPENDED', { orgId, name: org.name }, '::1');
    return org;
};

const activateOrganization = async (orgId, superadminId) => {
    const org = await updateOrganization(orgId, { status: 'active' });
    activityService.logActivity(superadminId, 'ORG_ACTIVATED', { orgId, name: org.name }, '::1');
    return org;
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
    const inviteLink = `${config.clientUrl}/set-password?token=${invToken}`;

    // Send email (swallow error for demo)
    try {
        await emailService.sendAdminInvitationEmail(email, name, inviteLink);
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
    const inviteLink = `${config.clientUrl}/set-password?token=${invToken}`;

    await pool.query('UPDATE users SET invited_at = NOW() WHERE id = $1', [adminId]);

    try {
        await emailService.sendAdminInvitationEmail(admin.email, admin.name, inviteLink);
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
const getGlobalBookingStats = async (search = null) => {
    let query = `
        SELECT 
            o.id as org_id,
            o.name as org_name,
            COUNT(a.id) as total_bookings,
            SUM(CASE WHEN DATE(a.created_at) = CURRENT_DATE THEN 1 ELSE 0 END) as today_bookings,
            SUM(CASE WHEN a.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
            SUM(CASE WHEN a.status = 'pending' THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN a.status = 'waitlisted_urgent' THEN 1 ELSE 0 END) as urgent
        FROM organizations o
        LEFT JOIN appointments a ON o.id = a.org_id
        WHERE o.status = 'active'
    `;
    const params = [];

    if (search) {
        // Global Appointment Search by Token, Phone, Name, or ID
        const searchRes = await pool.query(`
            SELECT a.*, o.name as org_name, u.name as user_name, r.name as resource_name
            FROM appointments a
            JOIN organizations o ON a.org_id = o.id
            LEFT JOIN users u ON a.user_id = u.id
            LEFT JOIN resources r ON a.resource_id = r.id
            WHERE a.id::text ILIKE $1 
               OR a.customer_name ILIKE $1 
               OR a.customer_phone ILIKE $1 
               OR a.token_number::text ILIKE $1
            LIMIT 50
        `, [`%${search}%`]);
        return { isSearch: true, results: searchRes.rows };
    }

    query += ` GROUP BY o.id, o.name ORDER BY total_bookings DESC`;
    const res = await pool.query(query, params);
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
    return cacheService.getOrSet('global_analytics', async () => {
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
    }, 300); // 5 min cache for historical
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
            version: pkg.version,
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
    return cacheService.getOrSet('global_monitor', async () => {
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
                COUNT(a.id) FILTER (WHERE a.status = 'pending') as pending,
                COUNT(a.id) FILTER (WHERE a.status = 'waitlisted_urgent') as urgent,
                COUNT(a.id) FILTER (WHERE a.status = 'serving') as serving,
                (SELECT COUNT(*) FROM slots s WHERE s.org_id = o.id AND DATE(s.start_time) = CURRENT_DATE AND s.is_active = TRUE) as active_slots,
                (SELECT COUNT(DISTINCT s.resource_id) FROM slots s WHERE s.org_id = o.id AND DATE(s.start_time) = CURRENT_DATE AND s.is_active = TRUE) as active_professionals
            FROM organizations o
            LEFT JOIN appointments a ON o.id = a.org_id AND DATE(a.created_at) = CURRENT_DATE
            WHERE o.status = 'active'
            GROUP BY o.id, o.name
            ORDER BY (COUNT(a.id) FILTER (WHERE a.status = 'waitlisted_urgent')) DESC, (COUNT(a.id) FILTER (WHERE a.status = 'pending')) DESC
        `);

        // 3. Global Professionals Summary
        const profRes = await pool.query(`
            SELECT COUNT(DISTINCT resource_id) as total_profs
            FROM slots
            WHERE DATE(start_time) = CURRENT_DATE AND is_active = TRUE
        `);

        const organizations = orgsRes.rows.map(org => {
            let status = 'idle';
            const pending = parseInt(org.pending);
            const urgent = parseInt(org.urgent);
            const waiting = pending + urgent;

            if (urgent > 5 || waiting > 30) status = 'critical';
            else if (urgent > 0 || waiting > 10) status = 'busy';
            else if (waiting > 0 || parseInt(org.serving) > 0) status = 'stable';

            return {
                ...org,
                waiting,
                pending,
                urgent,
                active_slots: parseInt(org.active_slots),
                active_professionals: parseInt(org.active_professionals),
                serving: parseInt(org.serving),
                status
            };
        });

        const stats = statsRes.rows[0];

        return {
            stats: {
                totalActiveQueues: parseInt(stats.total_active_orgs) || 0,
                totalWaiting: parseInt(stats.total_waiting) || 0,
                totalProfessionals: parseInt(profRes.rows[0].total_profs) || 0,
                avgWaitTime: Math.round(parseFloat(stats.avg_est_time) || 0),
                systemLoad: parseInt(stats.total_waiting) > 50 ? 'Heavy' : 'Optimal'
            },
            organizations
        };
    }, 30);
};

const getRevenueAnalytics = async () => {
    return cacheService.getOrSet('revenue_analytics', async () => {
        // 1. MRR Trend (Last 6 Months)
        const mrrTrend = await pool.query(`
            SELECT 
                TO_CHAR(d, 'Mon') as name,
                COALESCE(SUM(p.price_monthly), 0) as mrr
            FROM generate_series(
                DATE_TRUNC('month', NOW()) - INTERVAL '5 months',
                DATE_TRUNC('month', NOW()),
                '1 month'::interval
            ) d
            LEFT JOIN organizations o ON o.created_at <= d + INTERVAL '1 month' - INTERVAL '1 day' AND o.status = 'active'
            LEFT JOIN plans p ON o.plan_id = p.id
            GROUP BY d
            ORDER BY d ASC
        `);

        // 2. Revenue by Plan
        const revenueByPlan = await pool.query(`
            SELECT p.name, SUM(p.price_monthly) as value
            FROM organizations o
            JOIN plans p ON o.plan_id = p.id
            WHERE o.status = 'active'
            GROUP BY p.name
        `);

        return {
            mrrTrend: mrrTrend.rows,
            revenueByPlan: revenueByPlan.rows
        };
    }, 600);
};

const getOrgHealthScores = async () => {
    return cacheService.getOrSet('org_health_scores', async () => {
        const res = await pool.query(`
            SELECT 
                o.id,
                o.name,
                o.type,
                COUNT(a.id) as total_appointments,
                SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END)::float / NULLIF(COUNT(a.id), 0) * 100 as completion_rate,
                COALESCE(AVG(booked_count::float / NULLIF(max_capacity, 0)), 0) * 100 as utilization_rate
            FROM organizations o
            LEFT JOIN appointments a ON o.id = a.org_id
            LEFT JOIN slots s ON o.id = s.org_id
            GROUP BY o.id, o.name, o.type
            ORDER BY completion_rate DESC NULLS LAST
            LIMIT 10
        `);

        return res.rows.map(org => ({
            ...org,
            health_score: Math.round(((parseFloat(org.completion_rate) || 0) + (parseFloat(org.utilization_rate) || 0)) / 2)
        }));
    }, 300);
};

const getPlatformAuditTrail = async (filters, options) => {
    const { action, orgId } = filters;
    const page = options.page || 1;
    const limit = options.limit || 50;
    const offset = (page - 1) * limit;

    let query = `
        WITH unified_logs AS (
            SELECT 
                al.id, al.user_id as actor_id, al.action, al.details, al.ip_address, al.created_at,
                (al.details->>'orgId')::text as affected_org_id
            FROM activity_logs al
            
            UNION ALL
            
            SELECT 
                aal.id, aal.performed_by as actor_id, aal.action, aal.details, 'Internal' as ip_address, aal.created_at,
                (SELECT u.org_id::text FROM users u WHERE u.id = aal.admin_id) as affected_org_id
            FROM admin_activity_logs aal
        )
        SELECT 
            ul.*, 
            u.name as user_name, u.email as user_email
        FROM unified_logs ul
        LEFT JOIN users u ON ul.actor_id = u.id
        WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (action) {
        query += ` AND ul.action ILIKE $${paramIndex}`;
        params.push(`%${action}%`);
        paramIndex++;
    }

    if (orgId) {
        query += ` AND ul.affected_org_id = $${paramIndex}`;
        params.push(orgId);
        paramIndex++;
    }

    query += ` ORDER BY ul.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex+1}`;
    params.push(limit, offset);

    const logs = await pool.query(query, params);
    
    // Total count for combined tables
    const countRes = await pool.query(`
        SELECT (
            (SELECT COUNT(*) FROM activity_logs) + 
            (SELECT COUNT(*) FROM admin_activity_logs)
        ) as total
    `);

    return {
        logs: logs.rows,
        total: parseInt(countRes.rows[0].total)
    };
};

const getPlatformFinances = async () => {
    // 1. Total Incoming Today
    const incomingRes = await pool.query(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM wallet_transactions 
        WHERE type = 'credit' AND DATE(created_at) = CURRENT_DATE
    `);

    // 2. Pending Payouts
    const payoutsRes = await pool.query(`
        SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
        FROM payout_requests
        WHERE status = 'pending'
    `);

    // 3. Active Disputes
    const disputesRes = await pool.query(`
        SELECT COUNT(*) as count, COALESCE(SUM(price), 0) as total
        FROM appointments
        WHERE dispute_status = 'flagged'
    `);

    // 4. Global Wallet Summary
    const walletRes = await pool.query(`
        SELECT 
            SUM(balance) as available,
            SUM(locked_funds) as locked,
            SUM(disputed_balance) as disputed
        FROM wallets
    `);

    return {
        todayIncoming: parseFloat(incomingRes.rows[0].total),
        pendingPayouts: {
            count: parseInt(payoutsRes.rows[0].count),
            amount: parseFloat(payoutsRes.rows[0].total)
        },
        activeDisputes: {
            count: parseInt(disputesRes.rows[0].count),
            amount: parseFloat(disputesRes.rows[0].total)
        },
        globalWallet: {
            available: parseFloat(walletRes.rows[0].available) || 0,
            locked: parseFloat(walletRes.rows[0].locked) || 0,
            disputed: parseFloat(walletRes.rows[0].disputed) || 0
        }
    };
};

const getActiveDisputes = async () => {
    const res = await pool.query(`
        SELECT 
            a.id, a.customer_name, a.customer_phone, a.price, a.dispute_reason, 
            a.dispute_status, a.created_at, o.name as org_name
        FROM appointments a
        JOIN organizations o ON a.org_id = o.id
        WHERE a.dispute_status = 'flagged'
        ORDER BY a.updated_at DESC
    `);
    return res.rows;
};

const resolvePlatformDispute = async (appointmentId, decision, superadminId) => {
    const apptRes = await pool.query('SELECT org_id FROM appointments WHERE id = $1', [appointmentId]);
    if (apptRes.rows.length === 0) throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');
    const { org_id } = apptRes.rows[0];

    const walletService = require('./wallet.service');
    await walletService.resolveDispute(org_id, appointmentId, decision);

    // Update appointment status
    await pool.query(
        "UPDATE appointments SET dispute_status = 'resolved', updated_at = NOW() WHERE id = $1",
        [appointmentId]
    );

    // Log superadmin action
    await logAdminActivity(superadminId, `RESOLVE_DISPUTE_${decision.toUpperCase()}`, superadminId, { appointmentId });

    return { success: true, message: `Dispute resolved with decision: ${decision}` };
};

const getPayoutRequests = async (filters = {}) => {
    try {
        const { status } = filters;
        let query = `
            SELECT 
                pr.*, 
                o.name as org_name, 
                o.slug as org_slug,
                w.available_balance as current_wallet_balance
            FROM payout_requests pr
            JOIN wallets w ON pr.wallet_id = w.id
            JOIN organizations o ON w.org_id = o.id
        `;
        const params = [];
        if (status) {
            query += ' WHERE pr.status = $1';
            params.push(status);
        }
        query += ' ORDER BY pr.created_at DESC';
        
        const res = await pool.query(query, params);
        return res.rows;
    } catch (error) {
        console.error('[getPayoutRequests] FAILED:', {
            message: error.message,
            code: error.code,
            detail: error.detail
        });
        // If table doesn't exist or other DB error, return empty array instead of 500
        return [];
    }
};

const sendBroadcast = async (broadcastBody, superadminId) => {
    const { target, title, message, type, link } = broadcastBody;
    console.log('[sendBroadcast] Initiating broadcast:', { target, title, type, senderId: superadminId });
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Log the broadcast record (History)
        const logRes = await client.query(
            'INSERT INTO broadcast_logs (sender_id, target, title, message, type, link) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [superadminId, target, title, message, type, link]
        );
        
        // 2. Batch insert into notifications for all matching users
        let roleFilter = "role IN ('admin', 'user')"; // Default for 'all'
        if (target === 'admins') roleFilter = "role = 'admin'";
        else if (target === 'users') roleFilter = "role = 'user'";
        
        // Use COALESCE for notification_enabled to be safe with existing NULLs
        const insertQuery = `
            INSERT INTO notifications (user_id, title, message, type, link)
            SELECT id, $1, $2, $3, $4 FROM users
            WHERE ${roleFilter} 
              AND COALESCE(notification_enabled, true) = true
              AND is_suspended = false
        `;
        
        const notifyRes = await client.query(insertQuery, [title, message, type, link]);
        console.log(`[sendBroadcast] Notifications created for ${notifyRes.rowCount} users`);
        
        await client.query('COMMIT');
        
        // 3. Log Activity (Outside transaction to prevent rollback of broadcast if logging fails)
        try {
            await activityService.logActivity(superadminId, 'GLOBAL_BROADCAST', { target, title, recipientsCount: notifyRes.rowCount }, '::1');
        } catch (activityError) {
            console.warn('[sendBroadcast] Activity logging failed (non-critical):', activityError.message);
        }
        
        return logRes.rows[0];
    } catch (error) {
        console.error('[sendBroadcast] CRITICAL ERROR:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        
        // Only rollback if we haven't released the client or if transaction is active
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            console.error('[sendBroadcast] Rollback failed:', rollbackError.message);
        }
        throw error;
    } finally {
        client.release();
    }
};

const getBroadcastHistory = async () => {
    try {
        const res = await pool.query('SELECT b.*, u.name as sender_name FROM broadcast_logs b LEFT JOIN users u ON b.sender_id = u.id ORDER BY b.created_at DESC LIMIT 50');
        return res.rows;
    } catch (error) {
        console.error('[getBroadcastHistory] FAILED:', {
            message: error.message,
            code: error.code,
            detail: error.detail
        });
        // If table doesn't exist or other DB error, return empty array instead of 500
        return [];
    }
};

module.exports = {
    getRevenueAnalytics,
    getOrgHealthScores,
    getPlatformAuditTrail,
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
    verifyOrganization,
    unverifyOrganization,
    getPlatformFinances,
    getActiveDisputes,
    resolvePlatformDispute,
    sendBroadcast,
    getBroadcastHistory,
    getPayoutRequests,
    getRecentActivity: activityService.getRecentActivity
};
