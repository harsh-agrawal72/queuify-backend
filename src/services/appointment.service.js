const { pool } = require('../config/db');
const httpStatus = require('../utils/httpStatus');
const appointmentModel = require('../models/appointment.model');
const slotModel = require('../models/slot.model');
const userModel = require('../models/user.model'); // Need to fetch user email
const ApiError = require('../utils/ApiError');
const socket = require('../socket/index');
const emailService = require('./email.service');
const notificationService = require('./notification.service');

/**
 * Book an appointment
 * @param {Object} appointmentBody
 * @returns {Promise<Object>}
 */
const bookAppointment = async (appointmentBody) => {
    try {
        const result = await appointmentModel.createAppointment(appointmentBody);
        const { appointment, queue_number } = result;

        // 1. Check if Payment is Required
        if (parseFloat(appointment.price) > 0 && appointment.payment_status !== 'paid') {
            await pool.query("UPDATE appointments SET status = 'pending_payment' WHERE id = $1", [appointment.id]);
            appointment.status = 'pending_payment';
        }

        // Send Notifications & Emails Asynchronously only if confirmed/paid
        if (appointment.status !== 'pending_payment') {
            (async () => {
                try {
                    console.log(`[Booking-Async] Starting notification process for Appointment: ${appointment.id}`);
                    const appointmentWithDetails = await appointmentModel.getAppointmentById(appointment.id);
                    const user = await userModel.getUserById(appointment.user_id);
                const orgRes = await pool.query('SELECT name, contact_email, email_notification, new_booking_notification FROM organizations WHERE id = $1', [appointment.org_id]);
                const org = orgRes.rows[0];

                if (!appointmentWithDetails) {
                    console.error(`[Booking-Async] Could not fetch appointment details for ID: ${appointment.id}`);
                    return;
                }

                // 1. Notify User (respecting org-wide toggle AND user preference)
                const userEmailEnabled = user && user.email_notification_enabled !== false;
                const orgEmailEnabled = org && (org.email_notification === true || org.email_notification === null);

                try {
                    if (userEmailEnabled && user && user.email) {
                        console.log(`[Booking-Async] Sending booking confirmation email to ${user.email}`);
                        await emailService.sendBookingConfirmation(user.email, {
                            ...appointmentWithDetails,
                            token_number: queue_number
                        });
                    }
                } catch (emailErr) {
                    console.error(`[Booking-Async] User email failed:`, emailErr.message);
                }

                if (org && (org.new_booking_notification === true || org.new_booking_notification === null)) {
                    await notificationService.sendNotification(
                        appointment.user_id,
                        'Booking Confirmed',
                        `Your appointment for ${appointmentWithDetails.service_name} at ${appointmentWithDetails.org_name} is confirmed. Your Token is #${queue_number}.`,
                        'appointment',
                        `/appointments`
                    );
                }

                // 2. Notify Admins
                const orgBookingNotify = org && (org.new_booking_notification === true || org.new_booking_notification === null);
                if (orgBookingNotify) {
                    const admins = await userModel.getAdminsByOrg(appointment.org_id);
                    const adminMessage = `New booking from ${user?.name || 'Customer'} for ${appointmentWithDetails.service_name}. Token assigned: #${queue_number}`;

                    console.log(`[Booking-Async] Notifying ${admins.length} admins.`);
                    // In-App Notifications to all admins
                    for (const admin of admins) {
                        await notificationService.sendNotification(
                            admin.id,
                            'New Appointment Booking',
                            adminMessage,
                            'appointment',
                            `/admin/appointments?search=${appointment.id}`
                        );
                    }

                    // Email Notification to Org Contact
                        try {
                            if (orgEmailEnabled) {
                                console.log(`[Booking-Async] Sending admin notification email to ${org.contact_email}`);
                                await emailService.sendAdminBookingNotification(org.contact_email, {
                                    ...appointmentWithDetails,
                                    token_number: queue_number
                                });
                            }
                        } catch (emailErr) {
                            console.error(`[Booking-Async] Admin email failed:`, emailErr.message);
                        }
                }

                // 3. Emit Queue Update for real-time dashboard refresh
                try {
                    socket.emitQueueUpdate({
                        orgId: appointment.org_id,
                        serviceId: appointment.service_id,
                        resourceId: appointment.resource_id
                    }, {
                        type: 'new_booking',
                        appointmentId: appointment.id,
                        slotId: appointment.slot_id
                    });
                } catch (socketErr) {
                    console.error('[Booking-Async] Socket update failed:', socketErr.message);
                }

                if (appointment.slot_id) {
                    await checkAndNotifySlotWaiters(appointment.slot_id);
                }
            } catch (e) {
                console.error('[Booking-Async] FAILURE:', e);
                }
            })();
        }

        return { ...result, appointment };
    } catch (error) {
        if (error.message === 'DUPLICATE_BOOKING_WARNING') {
            throw new ApiError(httpStatus.CONFLICT, 'DUPLICATE_BOOKING_WARNING');
        }
        if (error.message === 'Slot not found') {
            throw new ApiError(httpStatus.NOT_FOUND, 'Slot not found');
        }
        if (error.message === 'Slot is fully booked') {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Slot is fully booked');
        }
        throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Booking failed: ' + error.message);
    }
};

/**
 * Cancel an appointment
 * @param {string} appointmentId
 * @param {string} userId
 * @returns {Promise<Object>}
 */
const cancelAppointment = async (appointmentId, userId, reason = null) => {
    try {
        const appointment = await appointmentModel.cancelAppointment(appointmentId, userId, reason);

        // Trigger waitlist filling after space opens up
        try {
            const reassignmentService = require('./reassignment.service');
            await reassignmentService.fillSlotFromWaitlist(appointment.slot_id);
        } catch (e) {
            console.error('[Cancel-WaitlistFill] Failed silently:', e.message);
        }

        try {
            const io = socket.getIO();
            io.to(`org_${appointment.org_id}`).emit('queue_update', {
                type: 'cancellation',
                slotId: appointment.slot_id
            });
        } catch (e) { console.error('Socket emit failed:', e); }

        // Send Notifications (Fire and Forget)
        (async () => {
            try {
                console.log(`[Cancel-Async] Starting notification process for Appointment: ${appointment.id}`);
                const user = await userModel.getUserById(appointment.user_id);
                const orgRes = await pool.query('SELECT name, contact_email, email_notification, new_booking_notification FROM organizations WHERE id = $1', [appointment.org_id]);
                const org = orgRes.rows[0];

                // For cancellation, we need full details for the email
                const appointmentWithDetails = await appointmentModel.getAppointmentById(appointment.id);

                // 1. Notify User (respecting preference)
                try {
                    if (user && user.email && user.email_notification_enabled !== false) {
                        console.log(`[Cancel-Async] Sending cancellation email to user: ${user.email}`);
                        await emailService.sendCancellationEmail(user.email, appointmentWithDetails || appointment);
                    }
                } catch (emailErr) {
                    console.error(`[Cancel-Async] User email failed:`, emailErr.message);
                }

                await notificationService.sendNotification(
                    appointment.user_id,
                    'Appointment Cancelled',
                    `Your appointment for ${appointment.service_name || 'Service'} has been cancelled.`,
                    'appointment',
                    `/appointments`
                );

                // 2. Notify Admins
                if (org && org.new_booking_notification) {
                    const admins = await userModel.getAdminsByOrg(appointment.org_id);
                    const adminMessage = `Appointment for ${user?.name || 'User'} (${appointment.service_name || 'Service'}) has been cancelled.`;

                    console.log(`[Cancel-Async] Notifying ${admins.length} admins.`);
                    // In-App Notifications to all admins
                    for (const admin of admins) {
                        await notificationService.sendNotification(
                            admin.id,
                            'Appointment Cancelled',
                            adminMessage,
                            'appointment',
                            `/admin/appointments?search=${appointment.id}`
                        );
                    }

                    // Email Notifications
                    try {
                        if (org.email_notification) {
                            if (org.contact_email) {
                                console.log(`[Cancel-Async] Sending cancellation email to org contact: ${org.contact_email}`);
                                await emailService.sendCancellationEmail(org.contact_email, appointmentWithDetails || appointment);
                            }

                            if (admins.length > 0) {
                                for (const admin of admins) {
                                    if (admin.email && admin.email !== org.contact_email) {
                                        console.log(`[Cancel-Async] Sending cancellation email to secondary admin: ${admin.email}`);
                                        await emailService.sendCancellationEmail(admin.email, appointmentWithDetails || appointment);
                                    }
                                }
                            }
                        }
                    } catch (emailErr) {
                        console.error(`[Cancel-Async] Admin/Org email failed:`, emailErr.message);
                    }
                }
                if (appointment.slot_id) {
                    await checkAndNotifySlotWaiters(appointment.slot_id);
                }

                // ── Auto-Refund Engine ──
                // Fire refund asynchronously so it doesn't block the cancellation response
                if (appointment.payment_status === 'paid' && parseFloat(appointment.price) > 0) {
                    const autoRefundService = require('./autoRefund.service');
                    const cancelledBy = userId ? 'user' : 'admin';
                    autoRefundService.processRefund(appointment.id, cancelledBy)
                        .then(result => console.log(`[Cancel-Async] Refund processed:`, result))
                        .catch(e => console.error('[Cancel-Async] Refund failed:', e.message));
                }
            } catch (e) { console.error('[Cancel-Async] FAILURE:', e); }
        })();

        return appointment;
    } catch (error) {
        console.error('[Cancel-Appointment] FAILURE:', error);
        throw error;
    }
};

// Socket module is already imported at the top

/**
 * Automaticaly advances the queue when an appointment is completed or cancelled.
 * Marks the next confirmed appointment as 'serving'.
 */
const advanceQueueAutomatically = async (serviceId, resourceId = null, slotId = null) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Resolve scope and date
        const { rows: [svcInfo] } = await client.query('SELECT queue_scope FROM services WHERE id = $1', [serviceId]);
        if (!svcInfo) return;

        const isPerResource = svcInfo.queue_scope === 'PER_RESOURCE';
        const partitionFilter = isPerResource
            ? (slotId ? 'slot_id = $1' : 'service_id = $1 AND resource_id = $2 AND DATE(created_at) = CURRENT_DATE')
            : (slotId
                ? 'service_id = $1 AND (SELECT start_time FROM slots WHERE id = slot_id) = (SELECT start_time FROM slots WHERE id = $2)'
                : 'service_id = $1 AND DATE(created_at) = CURRENT_DATE');

        const filterParams = isPerResource
            ? (slotId ? [slotId] : [serviceId, resourceId])
            : (slotId ? [serviceId, slotId] : [serviceId]);

        const { rows: [service] } = await client.query('SELECT org_id FROM services WHERE id = $1', [serviceId]);
        if (!service) return;

        // 2. Find if anyone is already 'serving' in THIS slot/session
        const servingRes = await client.query(
            `SELECT id FROM appointments WHERE ${partitionFilter} AND status = 'serving'`,
            filterParams
        );

        if (servingRes.rows.length === 0) {
            // Find the NEXT confirmed appointment in this slot/session
            const nextRes = await client.query(
                `SELECT id FROM appointments 
                 WHERE ${partitionFilter} AND status = 'confirmed' 
                 ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
                filterParams
            );

            if (nextRes.rows.length > 0) {
                const nextApptId = nextRes.rows[0].id;
                await client.query(
                    "UPDATE appointments SET status = 'serving', serving_started_at = NOW(), updated_at = NOW() WHERE id = $1",
                    [nextApptId]
                );
                console.log(`Queue advanced: Appointment ${nextApptId} is now serving.`);
            }
        }

        await client.query('COMMIT');

        // 3. Emit global update
        const updatedQueueData = await getQueueUpdateSnapshot(serviceId, resourceId, slotId);
        socket.emitQueueUpdate({
            orgId: service.org_id,
            serviceId,
            resourceId
        }, {
            type: 'queue_advancement',
            ...updatedQueueData
        });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Auto-advancement failed:', e);
    } finally {
        client.release();
    }
};

/**
 * Helper to get a snapshot of the current state for WebSocket emissions
 */
const getQueueUpdateSnapshot = async (serviceId, resourceId = null, slotId = null) => {
    const { rows: [svcInfo] } = await pool.query('SELECT queue_scope FROM services WHERE id = $1', [serviceId]);
    const isPerResource = svcInfo?.queue_scope === 'PER_RESOURCE';

    const partitionFilter = isPerResource
        ? (slotId ? 'a.slot_id = $1' : 'a.service_id = $1 AND a.resource_id = $2 AND DATE(a.created_at) = CURRENT_DATE')
        : (slotId
            ? 'a.service_id = $1 AND (SELECT start_time FROM slots WHERE id = a.slot_id) = (SELECT start_time FROM slots WHERE id = $2)'
            : 'a.service_id = $1 AND DATE(a.created_at) = CURRENT_DATE');

    const filterParams = isPerResource
        ? (slotId ? [slotId] : [serviceId, resourceId])
        : (slotId ? [serviceId, slotId] : [serviceId]);

    const { rows: [topAppt] } = await pool.query(
        `SELECT a.id FROM appointments a
         WHERE ${partitionFilter}
         AND a.status IN ('serving', 'pending', 'confirmed')
         ORDER BY (CASE WHEN a.status = 'serving' THEN 0 ELSE 1 END), a.created_at ASC
         LIMIT 1`,
        filterParams
    );

    if (!topAppt) return { current_serving: 0, people_ahead: 0 };

    const status = await getQueueStatus(topAppt.id);
    return {
        service_id: serviceId,
        resource_id: resourceId,
        slot_id: slotId,
        current_serving_number: status.current_serving_number,
        estimated_wait_time: status.estimated_wait_time
    };
};

/**
 * Update appointment status (e.g. completed, serving, no_show)
 */
const updateAppointmentStatus = async (appointmentId, status, orgId) => {
    const appointment = await appointmentModel.getAppointmentById(appointmentId);
    if (!appointment) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');
    }
    if (appointment.org_id !== orgId) {
        throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
    }

    // If status changed to completed, cancelled, or no_show, trigger auto-advancement
    if (['completed', 'cancelled', 'no_show'].includes(status)) {
        // USER REQUEST: Disable automatic "Start Serving" for the next appointment.
        // await advanceQueueAutomatically(appointment.service_id, appointment.resource_id, appointment.slot_id);
        
        // Also trigger waitlist fill if space opened up
        if (['cancelled', 'no_show'].includes(status) && appointment.slot_id) {
            try {
                const { fillSlotFromWaitlist } = require('./reassignment.service');
                await fillSlotFromWaitlist(appointment.slot_id);
            } catch (e) {
                console.error('[StatusUpdate-WaitlistFill] Failed silently:', e.message);
            }
        }
    }

    try {
        // Targeted Real-time update
        socket.emitQueueUpdate({
            orgId,
            serviceId: appointment.service_id,
            resourceId: appointment.resource_id
        }, {
            type: 'status_change',
            appointmentId,
            status,
            queue_number: appointment.queue_number
        });

        // Smart Queue Alerts
        if (status === 'serving') {
            checkAndNotifyDrift(appointmentId);
        }

        // Notifications logic (Fire and Forget)...
        (async () => {
            try {
                console.log(`[UserUpdate-Async] Starting notification process for Appointment: ${appointmentId}`);
                // Fetch full details including service and org names
                const appointmentWithDetails = await appointmentModel.getAppointmentById(appointmentId);
                const user = await userModel.getUserById(appointment.user_id);
                const orgRes = await pool.query('SELECT name, contact_email, email_notification, new_booking_notification FROM organizations WHERE id = $1', [orgId]);
                const org = orgRes.rows[0];

                if (!appointmentWithDetails) {
                    console.error(`[UserUpdate-Async] Could not fetch details for ID: ${appointmentId}`);
                    return;
                }

                try {
                    if (user && user.email && user.email_notification_enabled !== false) {
                        console.log(`[UserUpdate-Async] Sending email to user: ${user.email}`);
                        await emailService.sendStatusUpdateEmail(user.email, appointmentWithDetails);
                    }
                } catch (emailErr) {
                    console.error(`[UserUpdate-Async] User email failed:`, emailErr.message);
                }

                await notificationService.sendNotification(
                    appointment.user_id,
                    'Appointment Updated',
                    `Your ticket for ${appointmentWithDetails.service_name || 'Service'} is now ${status}.`,
                    'appointment',
                    `/appointments`
                );

                // 3. Trigger Refund if Admin Cancelled
                if (status === 'cancelled' && appointment.payment_status === 'paid' && parseFloat(appointment.price) > 0) {
                    try {
                        const autoRefundService = require('./autoRefund.service');
                        console.log(`[UserUpdate-Async] Admin cancelled paid appointment. Triggering refund for appt=${appointmentId}`);
                        await autoRefundService.processRefund(appointmentId, 'admin');
                    } catch (refundErr) {
                        console.error(`[UserUpdate-Async] Admin refund trigger failed:`, refundErr.message);
                    }
                }

                // 4. Notify Admins
                if (org && org.new_booking_notification) {
                    const admins = await userModel.getAdminsByOrg(orgId);
                    const adminMessage = `Status of ${user?.name || 'User'}'s appointment for ${appointmentWithDetails.service_name || 'Service'} updated to ${status}.`;

                    console.log(`[UserUpdate-Async] Notifying ${admins.length} admins.`);
                    // In-App Notifications
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
                    try {
                        if (org.email_notification) {
                            if (org.contact_email) {
                                console.log(`[UserUpdate-Async] Sending email to org contact: ${org.contact_email}`);
                                await emailService.sendStatusUpdateEmail(org.contact_email, appointmentWithDetails);
                            }

                            if (admins.length > 0) {
                                for (const admin of admins) {
                                    if (admin.email && admin.email !== org.contact_email) {
                                        console.log(`[UserUpdate-Async] Sending email to secondary admin: ${admin.email}`);
                                        await emailService.sendStatusUpdateEmail(admin.email, appointmentWithDetails);
                                    }
                                }
                            }
                        }
                    } catch (emailErr) {
                        console.error(`[UserUpdate-Async] Admin/Org email failed:`, emailErr.message);
                    }
                }
                if (appointment.slot_id) {
                    await checkAndNotifySlotWaiters(appointment.slot_id);
                }
            } catch (e) {
                console.error('[UserUpdate-Async] FAILURE:', e);
            }
        })();
    } catch (e) { console.error('Socket failed:', e); }

    return updatedAppointment;
};

/**
 * Check if a slot is facing delays or moving faster, and notify users proactively
 */
const checkAndNotifyDrift = async (appointmentId) => {
    try {
        const status = await getQueueStatus(appointmentId);
        const drift = status.time_drift_minutes;
        
        // CASE 1: DELAY (Arrive Later)
        if (drift >= 15) {
            const { rows: waiters } = await pool.query(
                "SELECT user_id, id FROM appointments WHERE slot_id = $1 AND status IN ('pending', 'confirmed') AND id != $2",
                [status.slot_id || (await appointmentModel.getAppointmentById(appointmentId)).slot_id, appointmentId]
            );

            for (const waiter of waiters) {
                await notificationService.sendNotification(
                    waiter.user_id,
                    '🤖 Smart Queue Alert',
                    `Queue is moving slightly slower. You can arrive approx. ${drift} mins later than planned.`,
                    'appointment',
                    `/appointments/${waiter.id}/queue`
                );
            }
        } 
        // CASE 2: FAST (Arrive Earlier)
        else if (drift <= -7) {
            const { rows: waiters } = await pool.query(
                "SELECT user_id, id FROM appointments WHERE slot_id = $1 AND status IN ('pending', 'confirmed') AND id != $2",
                [status.slot_id || (await appointmentModel.getAppointmentById(appointmentId)).slot_id, appointmentId]
            );

            for (const waiter of waiters) {
                await notificationService.sendNotification(
                    waiter.user_id,
                    '🚀 Smart Queue Alert',
                    `Queue is moving faster today! Please arrive approx. ${Math.abs(drift)} mins earlier than planned.`,
                    'appointment',
                    `/appointments/${waiter.id}/queue`
                );
            }
        }
    } catch (e) {
        console.error('[DriftAlert] Failed:', e.message);
    }
};


const getUserAppointments = async (userId) => {
    const appointments = await appointmentModel.getAppointmentsByUserId(userId);
    
    // Enrich active appointments with real-time AI metrics
    return Promise.all(appointments.map(async (appt) => {
        if (['pending', 'confirmed', 'serving'].includes(appt.status)) {
            try {
                // Get real-time average speed
                const avgTime = (await getSystemAverageSpeed(appt.service_id, appt.resource_id)) || appt.estimated_service_time || 15;
                const nominalAvg = appt.estimated_service_time || 15;
                
                // Simplified wait time for dashboard (can be further refined if start_time is far in future)
                // For now, let's use the logic: Wait = (People Ahead) * avgTime
                // If it's serving, it's roughly avgTime / 2 (on average)
                const peopleAhead = parseInt(appt.people_ahead) || 0;
                let estWait = peopleAhead * avgTime;
                
                // If there's a drift (AI vs Nominal), calculate it
                const nominalWait = peopleAhead * nominalAvg;
                const driftMins = Math.round(estWait - nominalWait);

                return {
                    ...appt,
                    estimated_service_time: avgTime,
                    estimated_wait_time: estWait,
                    time_drift_minutes: driftMins
                };
            } catch (e) {
                return appt;
            }
        }
        return appt;
    }));
};

/**
 * Calculate the average duration of recently completed appointments
 */
const getSystemAverageSpeed = async (serviceId, resourceId = null) => {
    const filterClause = resourceId ? 'service_id = $1 AND resource_id = $2' : 'service_id = $1';
    const params = resourceId ? [serviceId, resourceId] : [serviceId];

    const { rows } = await pool.query(
        `SELECT 
            EXTRACT(EPOCH FROM (completed_at - serving_started_at)) / 60 as duration
         FROM appointments
         WHERE ${filterClause} 
         AND status = 'completed'
         AND serving_started_at IS NOT NULL
         AND completed_at IS NOT NULL
         AND completed_at > NOW() - interval '30 days'
         ORDER BY completed_at DESC
         LIMIT 50`,
        params
    );

    if (rows.length === 0) return null;

    const sum = rows.reduce((acc, row) => acc + parseFloat(row.duration), 0);
    return Math.round(sum / rows.length);
};

const getQueueStatus = async (appointmentId) => {
    try {
        console.log(`[Diagnostic-v2.2] START for ID: ${appointmentId}`);
        
        // 1. Get Appointment
        const appointment = await appointmentModel.getAppointmentById(appointmentId);
        if (!appointment) {
            console.error(`[Diagnostic-v2.2] Appointment NOT FOUND: ${appointmentId}`);
            throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');
        }

        // 2. Get Service
        const { rows: svcRows } = await pool.query(
            'SELECT id, queue_type, estimated_service_time, queue_scope FROM services WHERE id = $1',
            [appointment.service_id]
        );
        const service = svcRows[0];
        if (!service) {
            console.error(`[Diagnostic-v2.2] Service NOT FOUND for ID: ${appointment.service_id}`);
            throw new ApiError(httpStatus.NOT_FOUND, 'Service not found');
        }

        // 3. Resolve Reference Date
        let referenceDate = appointment.created_at;
        if (appointment.slot_id) {
            try {
                const slotRes = await pool.query('SELECT start_time FROM slots WHERE id = $1', [appointment.slot_id]);
                if (slotRes.rows[0]?.start_time) {
                    referenceDate = slotRes.rows[0].start_time;
                }
            } catch (e) {
                console.warn(`[Diagnostic-v2.2] Slot fetch error (non-fatal): ${e.message}`);
            }
        }

        // 4. Ranking Query with safe SQL types
        const isPerResource = service.queue_scope === 'PER_RESOURCE';
        const scopeId = isPerResource ? (appointment.resource_id || appointment.service_id) : appointment.service_id;
        
        // Use a default date if referenceDate is null to avoid SQL crashes
        const queryDate = referenceDate || new Date();

        const { rows: rankedRows } = await pool.query(
            `WITH RankedQueue AS (
                SELECT 
                    a.id, a.status, a.slot_id, sl.start_time as slot_start, a.serving_started_at,
                    ROW_NUMBER() OVER (PARTITION BY a.slot_id ORDER BY a.created_at ASC) as q_rank
                FROM appointments a
                LEFT JOIN slots sl ON a.slot_id = sl.id
                WHERE a.status IN ('serving', 'pending', 'confirmed', 'completed', 'no_show')
                AND a.slot_id = $1::uuid
             )
             SELECT * FROM RankedQueue`,
            [appointment.slot_id]
        );

        console.log(`[Diagnostic-v2.3] Ranked rows in slot: ${rankedRows.length}`);

        const myEntry = rankedRows.find(r => r.id === appointmentId);
        const myRank = myEntry ? parseInt(myEntry.q_rank) : 0;
        const servingEntry = rankedRows.find(r => r.status === 'serving');
        
        let currentServingNumber = 0;
        if (servingEntry) {
            currentServingNumber = parseInt(servingEntry.q_rank);
        } else {
            const firstWaiting = rankedRows.find(r => ['pending', 'confirmed'].includes(r.status));
            currentServingNumber = firstWaiting ? Math.max(0, parseInt(firstWaiting.q_rank) - 1) : 0;
        }

        const peopleAhead = Math.max(0, myRank - (servingEntry ? currentServingNumber : currentServingNumber + 1));

        // 5. Advanced Math v2.0
        let estimatedWaitMinutes = 0;
        const avgTime = (await getSystemAverageSpeed(appointment.service_id, appointment.resource_id)) || service.estimated_service_time || 15;
        const now = new Date();
        let waitMinutesTillStart = 0;
        
        if (appointment.status === 'serving') {
            estimatedWaitMinutes = 0;
        } else if (servingEntry && servingEntry.serving_started_at) {
            const servingRank = parseInt(servingEntry.q_rank);
            const startTime = new Date(servingEntry.serving_started_at);
            if (!isNaN(startTime.getTime())) {
                const timeSpent = (now - startTime) / 60000;
                const remainingTime = Math.max(0, avgTime - timeSpent);
                const middlePeople = Math.max(0, myRank - servingRank - 1);
                estimatedWaitMinutes = remainingTime + (middlePeople * avgTime);
            } else {
                estimatedWaitMinutes = peopleAhead * avgTime;
            }
        } else {
            const baseDate = referenceDate ? new Date(referenceDate) : now;
            const baseStartTime = isNaN(baseDate.getTime()) || baseDate < now ? now : baseDate;
            waitMinutesTillStart = (baseStartTime - now) / 60000;
            const peopleWaitingAhead = Math.max(0, myRank - 1);
            estimatedWaitMinutes = Math.max(0, waitMinutesTillStart) + (peopleWaitingAhead * avgTime);
        }

        if (isNaN(estimatedWaitMinutes)) estimatedWaitMinutes = peopleAhead * avgTime;

        // 6. Safe formatting
        const expectedStartTime = new Date(now.getTime() + Math.round(estimatedWaitMinutes) * 60000);
        const safeISO = (d) => {
            try {
                if (!d) return null;
                const dateObj = new Date(d);
                return isNaN(dateObj.getTime()) ? null : dateObj.toISOString();
            } catch (e) { return null; }
        };

        // 6. Drift Detection (AI Difference)
        const nominalAvg = service.estimated_service_time || 15;
        const waitMinutesTillStartVal = Math.max(0, waitMinutesTillStart || 0);
        const nominalWaitUntilTurn = waitMinutesTillStartVal + (peopleAhead * nominalAvg);
        const timeDriftMinutes = Math.round(estimatedWaitMinutes - nominalWaitUntilTurn);

        return {
            queue_number: myRank,
            myRank: myRank,
            live_queue_number: myRank,
            current_serving_number: servingEntry ? currentServingNumber : 0,
            serving_token: servingEntry ? currentServingNumber : 0,
            people_ahead: peopleAhead,
            estimated_wait_time: Math.round(estimatedWaitMinutes),
            estimated_service_time: avgTime,
            time_drift_minutes: timeDriftMinutes,
            total_in_slot: rankedRows.length,
            expected_start_time: safeISO(expectedStartTime),
            slot_start_time: safeISO(referenceDate),
            status: appointment.status,
            is_serving: appointment.status === 'serving',
            org_id: appointment.org_id
        };
    } catch (error) {
        console.error(`[Diagnostic-CRITICAL-500] ID ${appointmentId}:`, error);
        // If it's not a handled 404, we want to know why it crashed
        if (!(error instanceof ApiError)) {
            console.error('Stack Trace:', error.stack);
        }
        throw error;
    }
};

/**
 * Reschedule an appointment
 * @param {string} appointmentId
 * @param {string} userId
 * @param {string} newSlotId
 * @returns {Promise<Object>}
 */
const rescheduleAppointment = async (appointmentId, userId, newSlotId, isAdmin = false, orgId = null) => {
    try {
        const result = await appointmentModel.rescheduleAppointment(appointmentId, userId, newSlotId, isAdmin, orgId);
        const { appointment, queue_number, oldSlotId } = result;

        // Trigger notifications for BOTH old and new slots
        if (oldSlotId) {
            checkAndNotifySlotWaiters(oldSlotId).catch(err => console.error(`[Reschedule-Notify-Old] Error:`, err));
        }
        if (appointment.slot_id) {
            checkAndNotifySlotWaiters(appointment.slot_id).catch(err => console.error(`[Reschedule-Notify-New] Error:`, err));
        }

        // Trigger waitlist/rebalance logic if needed - optional enhancement

        // Socket update
        try {
            const io = socket.getIO();
            io.to(`org_${appointment.org_id}`).emit('queue_update', {
                type: 'reschedule',
                appointmentId: appointment.id,
                newSlotId: appointment.slot_id
            });
        } catch (e) { console.error('Socket emit failed:', e); }

        // Notifications (Fire and Forget)
        (async () => {
            try {
                const appointmentWithDetails = await appointmentModel.getAppointmentById(appointment.id);
                const user = await userModel.getUserById(appointment.user_id);
                const orgRes = await pool.query('SELECT contact_email, email_notification FROM organizations WHERE id = $1', [appointment.org_id]);
                const org = orgRes.rows[0];

                const userEmailEnabled = user && user.email_notification_enabled !== false;
                const orgEmailEnabled = org && (org.email_notification === true || org.email_notification === null);
                const userNotifyEnabled = user && user.notification_enabled !== false;

                try {
                    if (userEmailEnabled && user?.email) {
                        await emailService.sendBookingConfirmation(user.email, appointmentWithDetails);
                    }
                } catch (emailErr) {
                    console.error(`[Reschedule-Async] Email failed:`, emailErr.message);
                }

                if (userNotifyEnabled) {
                    await notificationService.sendNotification(
                        appointment.user_id,
                        'Appointment Rescheduled',
                        `Your appointment has been successfully moved to ${new Date(appointmentWithDetails.slot_start).toLocaleString()}. New Token: #${appointment.token_number || 1}`,
                        'appointment',
                        `/appointments`
                    );
                }

                // Notify Admins
                const admins = await userModel.getAdminsByOrg(appointment.org_id);
                for (const admin of admins) {
                    await notificationService.sendNotification(
                        admin.id,
                        'Appointment Rescheduled',
                        `${user?.name || 'User'} has rescheduled their appointment to a new slot.`,
                        'appointment',
                        `/admin/appointments?search=${appointment.id}`
                    );
                }
            } catch (e) { console.error('[Reschedule-Async] Error:', e); }
        })();

        return result;
    } catch (error) {
                if (error.message === 'Appointment not found') throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');
        if (error.message === 'New slot not found or inactive') throw new ApiError(httpStatus.NOT_FOUND, 'New slot not found or inactive');
        if (error.message === 'New slot is fully booked') throw new ApiError(httpStatus.BAD_REQUEST, 'New slot is fully booked');
        if (error.message.includes('Cannot reschedule')) throw new ApiError(httpStatus.BAD_REQUEST, error.message);
        throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Rescheduling failed: ' + error.message);
    }
};

/**
 * Check and notify users who are waiting for a slot to reach their preferred time
 */
const checkAndNotifySlotWaiters = async (slotId) => {
    const slotNotificationModel = require('../models/slot_notification.model');
    const slotModel = require('../models/slot.model');
    
    try {
        // 1. Get current slot status
        const slot = await slotModel.getSlotById(slotId);
        if (!slot) return;

        // 2. Fetch service duration & fallback org details
        const res = await pool.query(`
            SELECT s.estimated_service_time, s.name as service_name, o.name as org_name, s.org_id
            FROM services s
            JOIN organizations o ON s.org_id = o.id
            WHERE s.id = (
                SELECT service_id FROM resource_services WHERE resource_id = $1 LIMIT 1
            )
        `, [slot.resource_id]);
        
        const serviceData = res.rows[0];
        const estimatedServiceTime = serviceData?.estimated_service_time || 30;

        const now = new Date();
        const slotStart = new Date(slot.start_time);
        const baseTime = slotStart > now ? slotStart : now;
        const minutesToAdd = slot.booked_count * estimatedServiceTime;
        const currentEstimatedTime = new Date(baseTime.getTime() + minutesToAdd * 60000);

        // 3. Find pending notifications that match (desired_time <= currentEstimatedTime)
        const pending = await slotNotificationModel.getPendingNotificationsForSlot(slotId, currentEstimatedTime);
        
        if (pending.length > 0) {
            const notificationIds = [];
            const timeStr = new Intl.DateTimeFormat('en-IN', {
                hour: 'numeric',
                minute: 'numeric',
                hour12: true,
                timeZone: 'Asia/Kolkata'
            }).format(currentEstimatedTime);

            for (const req of pending) {
                try {
                    let autoBooked = false;
                    let autoBookError = null;

                    // A. Auto-Booking Logic
                    if (req.auto_book && req.service_id) {
                        try {
                            console.log(`[Auto-Book] Attempting auto-booking for user ${req.user_id} on slot ${slotId}`);
                            await bookAppointment({
                                userId: req.user_id,
                                slotId: req.slot_id,
                                serviceId: req.service_id,
                                resourceId: req.resource_id,
                                orgId: slot.org_id,
                                customer_name: req.user_name,
                                customer_phone: req.customer_phone || (await userModel.getUserById(req.user_id))?.phone,
                                bypassDuplicate: false
                            });
                            autoBooked = true;
                        } catch (bookErr) {
                            console.error(`[Auto-Book] Failed for user ${req.user_id}:`, bookErr.message);
                            autoBookError = bookErr.message === 'DUPLICATE_BOOKING_WARNING' 
                                ? 'You already have an active booking for this slot'
                                : (bookErr.message || 'Slot became full or service unavailable');
                        }
                    }

                    // B. Internal Notification
                    const userNotifyEnabled = req.notification_enabled !== false;
                    const orgNotifyEnabled = req.org_notify_enabled !== false;

                    if (userNotifyEnabled && orgNotifyEnabled) {
                        const notifyTitle = autoBooked ? 'Appointment Auto-Booked!' : (autoBookError ? 'Auto-Booking Failed' : 'Slot Time Reached!');
                        const notifyMessage = autoBooked 
                            ? `Good news! Your appointment for ${req.service_name || serviceData?.service_name} was automatically booked for you as the time reached ${timeStr}.`
                            : (autoBookError 
                                ? `We tried to auto-book your appointment for ${req.service_name || serviceData?.service_name}, but it failed: ${autoBookError}. Please book manually now!`
                                : `The estimated time for ${req.service_name || serviceData?.service_name || 'your slot'} has reached ${timeStr}. Book now!`);

                        await notificationService.sendNotification(
                            req.user_id,
                            notifyTitle,
                            notifyMessage,
                            'slot_update',
                            autoBooked ? '/appointments' : '/dashboard'
                        );
                    }
                    
                    notificationIds.push(req.id);
                    
                    // C. Email Notification
                    const userEmailEnabled = req.email_notification_enabled !== false;

                    if (req.user_email && userEmailEnabled) {
                        try {
                            const emailSubject = autoBooked ? 'Appointment Auto-Booked Successfully' : 'Your Slot Time Reached';
                            const emailText = autoBooked
                                ? `Your appointment for ${req.service_name || serviceData?.service_name} at ${req.org_name || serviceData?.org_name} has been automatically booked for you.\n\nEstimated Time: ${timeStr}\n\nYou can view your booking in your dashboard.`
                                : `The estimated time for your desired slot has reached ${timeStr}.\n\n` + (autoBookError ? `Auto-booking failed: ${autoBookError}. ` : '') + (req.service_name ? `Service: ${req.service_name}. ` : '') + `Please visit the dashboard to secure your spot if you haven't already.`;

                            await emailService.sendGenericEmail(req.user_email, emailSubject, emailText);
                        } catch (e) { console.error('[Auto-Book-Email] Error:', e.message); }
                    }
                } catch (err) {
                    console.error(`[checkAndNotifySlotWaiters] Error processing req ${req.id}:`, err.message);
                }
            }
            if (notificationIds.length > 0) {
                await slotNotificationModel.markAsNotified(notificationIds);
            }
        }
    } catch (e) {
        console.error('[NotifyWaiters] Error:', e.message);
    }
};

/**
 * Propose a reschedule (Admin)
 */
const proposeReschedule = async (appointmentId, orgId, proposedSlotId, reason) => {
    try {
        const appointment = await appointmentModel.proposeReschedule(appointmentId, orgId, proposedSlotId, reason);
        
        // Notify User
        (async () => {
            try {
                const user = await userModel.getUserById(appointment.user_id);
                const slot = await slotModel.getSlotById(proposedSlotId);
                const timeStr = new Date(slot.start_time).toLocaleString();

                const orgRes = await pool.query('SELECT name, contact_email, email_notification, new_booking_notification FROM organizations WHERE id = $1', [orgId]);
                const org = orgRes.rows[0];
                const userEmailEnabled = user && user.email_notification_enabled !== false;
                const orgEmailEnabled = org && (org.email_notification === true || org.email_notification === null);
                const userNotifyEnabled = user && user.notification_enabled !== false;
                const orgNotifyEnabled = org && (org.new_booking_notification === true || org.new_booking_notification === null);

                if (userNotifyEnabled) {
                    await notificationService.sendNotification(
                        appointment.user_id,
                        'Reschedule Proposed',
                        `Business has proposed a new time: ${timeStr}. Reason: ${reason}. Accept for priority!`,
                        'appointment',
                        `/appointments`
                    );
                }

                if (userEmailEnabled && user?.email) {
                    await emailService.sendGenericEmail(user.email, 'Reschedule Proposal', `The business has proposed a new time for your appointment: ${timeStr}. \n\nReason: ${reason}\n\nPlease visit your dashboard to accept or decline.`);
                }
            } catch (e) { console.error('[Propose-Async] Error:', e); }
        })();

        return appointment;
    } catch (error) {
        throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * Respond to a reschedule proposal (User)
 */
const respondToReschedule = async (appointmentId, userId, action) => {
    try {
        const result = await appointmentModel.respondToReschedule(appointmentId, userId, action);
        
        // Notify Admins and User on response
        (async () => {
            try {
                const appointment = action === 'accept' ? result.appointment : result;
                const appointmentWithDetails = await appointmentModel.getAppointmentById(appointmentId);
                const user = await userModel.getUserById(userId);
                const orgRes = await pool.query('SELECT name, contact_email, email_notification FROM organizations WHERE id = $1', [appointment.org_id]);
                const org = orgRes.rows[0];
                
                const message = `${user?.name || 'User'} has ${action}ed the reschedule proposal.`;
                const admins = await userModel.getAdminsByOrg(appointment.org_id);
                
                for (const admin of admins) {
                    await notificationService.sendNotification(
                        admin.id,
                        'Reschedule Response',
                        message,
                        'appointment',
                        `/admin/appointments?search=${appointmentId}`
                    );
                }

                // Email Notifications
                const userEmailEnabled = user && user.email_notification_enabled !== false;
                const orgEmailEnabled = org && (org.email_notification === true || org.email_notification === null);

                if (action === 'accept') {
                    // Send confirmation to User
                    if (userEmailEnabled && user?.email) {
                        await emailService.sendRescheduleAcceptanceEmail(user.email, {
                            ...appointmentWithDetails,
                            token_number: appointment.token_number || 1
                        });
                    }
                    
                    // Trigger slot notifications for both slots
                    if (result.oldSlotId) checkAndNotifySlotWaiters(result.oldSlotId);
                    if (appointment.slot_id) checkAndNotifySlotWaiters(appointment.slot_id);
                } else if (action === 'decline') {
                    // Send rejection notice to Admin (Org Contact Email)
                    if (orgEmailEnabled && org?.contact_email) {
                        await emailService.sendRescheduleRejectionEmail(org.contact_email, user?.name || 'User', appointmentWithDetails);
                    }
                }
            } catch (e) { console.error('[Respond-Async] Error:', e); }
        })();

    } catch (error) {
        throw new ApiError(httpStatus.BAD_REQUEST, error.message);
    }
};

/**
 * Trigger Emergency Mode (Bulk Reschedule)
 */
const triggerEmergencyMode = async (orgId, resourceId, date) => {
    const reassignmentService = require('./reassignment.service');
    return reassignmentService.triggerEmergencyMode(orgId, resourceId, date);
};

const verifyOtp = async (appointmentId, otp, orgId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch appointment details
        const res = await client.query(
            'SELECT id, otp_code, org_id, price, payment_status, status FROM appointments WHERE id = $1',
            [appointmentId]
        );
        const appointment = res.rows[0];

        if (!appointment) {
            throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');
        }

        if (appointment.org_id !== orgId) {
            throw new ApiError(httpStatus.FORBIDDEN, 'Unauthorized access to this appointment');
        }

        // 2. Check if already completed
        if (appointment.status === 'completed') {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Appointment is already completed');
        }

        // 3. Verify OTP
        // Detailed logging to solve the "Invalid OTP" mystery
        console.log(`[OTP-Verify] ID: ${appointmentId}, DB-OTP: "${appointment.otp_code}", Provided: "${otp}"`);
        
        const storedOtp = String(appointment.otp_code || '').trim();
        const providedOtp = String(otp || '').trim();

        if (storedOtp !== providedOtp) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid 4-digit OTP provided');
        }

        // 4. If Paid, release funds from escrow
        if (parseFloat(appointment.price) > 0) {
            const walletService = require('./wallet.service');
            await walletService.releaseFunds(appointment.org_id, appointment.id, client);
        }

        // 5. Update Status to Completed
        await client.query(
            "UPDATE appointments SET status = 'completed', completed_at = NOW() WHERE id = $1",
            [appointmentId]
        );

        await client.query('COMMIT');

        // Logic for auto-advancement after completion (Fire and Forget)
        (async () => {
            try {
                console.log(`[OTP] Appointment ${appointmentId} verified and completed.`);
            } catch (e) {
                console.error('[OTP-Async] Advancement failed:', e);
            }
        })();

        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[verifyOtp] Error:', error);
        throw error;
    } finally {
        client.release();
    }
};

/**
 * User signals arrival at the clinic
 */
const markArrived = async (appointmentId, userId) => {
    const res = await pool.query(
        "UPDATE appointments SET check_in_method = 'user_signal', updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *",
        [appointmentId, userId]
    );
    if (res.rows.length === 0) throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found or unauthorized');
    return res.rows[0];
};

/**
 * User flags a dispute for an appointment
 */
const flagDispute = async (appointmentId, userId, reason) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Verify appointment exists and belongs to user
        const apptRes = await client.query(
            "SELECT * FROM appointments WHERE id = $1 AND user_id = $2 FOR UPDATE",
            [appointmentId, userId]
        );
        if (apptRes.rows.length === 0) throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');
        const appt = apptRes.rows[0];

        // 2. Only allow flagging if not already resolved
        if (appt.dispute_status === 'resolved') {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Dispute already resolved');
        }

        // 3. Update appointment status
        await client.query(
            "UPDATE appointments SET dispute_status = 'flagged', dispute_reason = $1, updated_at = NOW() WHERE id = $2",
            [reason, appointmentId]
        );

        // 4. Hold funds if paid
        if (appt.payment_status === 'paid' && parseFloat(appt.price) > 0) {
            const walletService = require('./wallet.service');
            await walletService.holdFundsForDispute(appt.org_id, appointmentId, reason);
        }

        await client.query('COMMIT');
        return { success: true, message: 'Dispute flagged and funds held' };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    bookAppointment,
    cancelAppointment,
    updateAppointmentStatus,
    getUserAppointments,
    getQueueStatus,
    advanceQueueAutomatically,
    getSystemAverageSpeed,
    rescheduleAppointment,
    checkAndNotifySlotWaiters,
    proposeReschedule,
    respondToReschedule,
    triggerEmergencyMode,
    verifyOtp,
    markArrived,
    flagDispute
};
