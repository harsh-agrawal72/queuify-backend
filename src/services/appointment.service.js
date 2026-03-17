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

        // Send Notifications & Emails Asynchronously to not block the response
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

                if (orgEmailEnabled && userEmailEnabled && user && user.email) {
                    console.log(`[Booking-Async] Sending booking confirmation email to ${user.email}`);
                    await emailService.sendBookingConfirmation(user.email, appointmentWithDetails);
                } else {
                    console.log(`[Booking-Async] Skipping user email. OrgEnabled: ${orgEmailEnabled}, UserEnabled: ${userEmailEnabled}`);
                }

                if (org && (org.new_booking_notification === true || org.new_booking_notification === null)) {
                    await notificationService.sendNotification(
                        appointment.user_id,
                        'Booking Confirmed',
                        `Your appointment for ${appointmentWithDetails.service_name} at ${appointmentWithDetails.org_name} is confirmed. Token: ${appointmentWithDetails.token_number}`,
                        'appointment',
                        `/appointments`
                    );
                }

                // 2. Notify Admins
                const orgBookingNotify = org && (org.new_booking_notification === true || org.new_booking_notification === null);
                if (orgBookingNotify) {
                    const admins = await userModel.getAdminsByOrg(appointment.org_id);
                    const adminMessage = `New booking received from ${user?.name || 'User'} for ${appointmentWithDetails.service_name}. Token: ${appointmentWithDetails.token_number}`;

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
                    if (orgEmailEnabled && org.contact_email) {
                        console.log(`[Booking-Async] Sending admin notification email to ${org.contact_email}`);
                        await emailService.sendAdminBookingNotification(org.contact_email, appointmentWithDetails);
                    }
                }
            } catch (e) {
                console.error('[Booking-Async] FAILURE:', e);
            }
        })();

        return result;
    } catch (error) {
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
const cancelAppointment = async (appointmentId, userId) => {
    try {
        const appointment = await appointmentModel.cancelAppointment(appointmentId, userId);

        try {
            const io = socket.getIO();
            io.to(appointment.org_id).emit('queue_update', {
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
                if (user && user.email && user.email_notification_enabled !== false) {
                    console.log(`[Cancel-Async] Sending cancellation email to user: ${user.email}`);
                    await emailService.sendCancellationEmail(user.email, appointmentWithDetails || appointment);
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
                }
            } catch (e) { console.error('[Cancel-Async] FAILURE:', e); }
        })();

        return appointment;
    } catch (error) {
        if (error.message === 'Appointment not found') {
            throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');
        }
        if (error.message === 'Forbidden') {
            throw new ApiError(httpStatus.FORBIDDEN, 'You can only cancel your own appointments');
        }
        if (error.message === 'Appointment already cancelled') {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Appointment already cancelled');
        }
        throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Cancellation failed');
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

    const updatedAppointment = await appointmentModel.updateAppointmentStatus(appointmentId, status);

    // If status changed to completed, cancelled, or no_show, trigger auto-advancement
    if (['completed', 'cancelled', 'no_show'].includes(status)) {
        await advanceQueueAutomatically(appointment.service_id, appointment.resource_id, appointment.slot_id);
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

                if (user && user.email && user.email_notification_enabled !== false) {
                    console.log(`[UserUpdate-Async] Sending email to user: ${user.email}`);
                    await emailService.sendStatusUpdateEmail(user.email, appointmentWithDetails);
                }

                await notificationService.sendNotification(
                    appointment.user_id,
                    'Appointment Updated',
                    `Your ticket for ${appointmentWithDetails.service_name || 'Service'} is now ${status}.`,
                    'appointment',
                    `/appointments`
                );

                // 2. Notify Admins
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
                }
            } catch (e) {
                console.error('[UserUpdate-Async] FAILURE:', e);
            }
        })();
    } catch (e) { console.error('Socket failed:', e); }

    return updatedAppointment;
};


const getUserAppointments = async (userId) => {
    return appointmentModel.getAppointmentsByUserId(userId);
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
         ORDER BY completed_at DESC
         LIMIT 10`,
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
                    ROW_NUMBER() OVER (ORDER BY COALESCE(sl.start_time, a.created_at) ASC, a.created_at ASC) as q_rank
                FROM appointments a
                LEFT JOIN slots sl ON a.slot_id = sl.id
                WHERE a.status IN ('serving', 'pending', 'confirmed', 'completed', 'no_show')
                AND (
                    ${isPerResource ? 'a.resource_id' : 'a.service_id'} = $1::uuid
                )
                AND DATE(COALESCE(sl.start_time, a.created_at)) = DATE($2)
             )
             SELECT * FROM RankedQueue`,
            [scopeId, queryDate]
        );

        console.log(`[Diagnostic-v2.2] Ranked rows found: ${rankedRows.length}`);

        const myEntry = rankedRows.find(r => r.id === appointmentId);
        const myRank = myEntry ? parseInt(myEntry.q_rank) : 0;
        const servingEntry = rankedRows.find(r => r.status === 'serving');
        
        let currentServingNumber = 0;
        if (servingEntry) {
            currentServingNumber = parseInt(servingEntry.q_rank);
        } else {
            const firstWaiting = rankedRows.find(r => ['pending', 'confirmed'].includes(r.status));
            currentServingNumber = firstWaiting ? Math.max(0, parseInt(firstWaiting.q_rank) - 1) : myRank;
        }

        const peopleAhead = Math.max(0, myRank - (servingEntry ? currentServingNumber : currentServingNumber + 1));

        // 5. Advanced Math v2.0
        let estimatedWaitMinutes = 0;
        const avgTime = (await getSystemAverageSpeed(appointment.service_id, appointment.resource_id)) || service.estimated_service_time || 15;
        const now = new Date();
        
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
            const waitMinutesTillStart = (baseStartTime - now) / 60000;
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

        return {
            queue_number: myRank,
            myRank: myRank,
            current_serving_number: servingEntry ? currentServingNumber : 0,
            people_ahead: peopleAhead,
            estimated_wait_time: Math.round(estimatedWaitMinutes),
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

module.exports = {
    bookAppointment,
    cancelAppointment,
    updateAppointmentStatus,
    getUserAppointments,
    getQueueStatus,
    advanceQueueAutomatically,
    getSystemAverageSpeed
};
