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
                const appointmentWithDetails = await appointmentModel.getAppointmentById(appointment.id);
                const user = await userModel.getUserById(appointment.user_id);
                const orgRes = await pool.query('SELECT name, contact_email, email_notification, new_booking_notification FROM organizations WHERE id = $1', [appointment.org_id]);
                const org = orgRes.rows[0];

                // 1. Notify User (respecting org-wide toggle AND user preference)
                if (org && org.email_notification && user && user.email && user.email_notification_enabled !== false) {
                    await emailService.sendBookingConfirmation(user.email, appointmentWithDetails);
                }

                if (org && org.new_booking_notification) {
                    await notificationService.sendNotification(
                        appointment.user_id,
                        'Booking Confirmed',
                        `Your appointment for ${appointmentWithDetails.service_name} at ${appointmentWithDetails.org_name} is confirmed. Token: ${appointmentWithDetails.token_number}`,
                        'appointment',
                        `/appointments`
                    );
                }

                // 2. Notify Admins
                if (org && org.new_booking_notification) {
                    const admins = await userModel.getAdminsByOrg(appointment.org_id);
                    const adminMessage = `New booking received from ${user?.name || 'User'} for ${appointmentWithDetails.service_name}. Token: ${appointmentWithDetails.token_number}`;

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
                    if (org.email_notification && org.contact_email) {
                        const subject = `New Booking: ${appointmentWithDetails.token_number}`;
                        const html = `<h2>New Appointment Booking</h2>
                            <p>A new appointment has been booked at your organization.</p>
                            <p><strong>User:</strong> ${user?.name || 'N/A'}</p>
                            <p><strong>Service:</strong> ${appointmentWithDetails.service_name}</p>
                            <p><strong>Token:</strong> ${appointmentWithDetails.token_number}</p>`;
                        await emailService.sendEmail(org.contact_email, subject, html);
                    }
                }
            } catch (e) {
                console.error('Notification/Email failed during booking:', e);
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

        // Send Notifications
        try {
            const user = await userModel.getUserById(appointment.user_id);
            const orgRes = await pool.query('SELECT name, contact_email, email_notification, new_booking_notification FROM organizations WHERE id = $1', [appointment.org_id]);
            const org = orgRes.rows[0];

            // 1. Notify User (respecting preference)
            if (user && user.email && user.email_notification_enabled !== false) {
                await emailService.sendCancellationEmail(user.email, appointment);
            }

            await notificationService.sendNotification(
                appointment.user_id,
                'Appointment Cancelled',
                `Your appointment for ${appointment.service_name} at ${appointment.org_name} has been cancelled.`,
                'appointment',
                `/appointments`
            );

            // 2. Notify Admins
            if (org && org.new_booking_notification) {
                const admins = await userModel.getAdminsByOrg(appointment.org_id);
                const adminMessage = `Appointment for ${user?.name || 'User'} (${appointment.service_name}) has been cancelled.`;

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
                if (org.email_notification && org.contact_email) {
                    await emailService.sendCancellationEmail(org.contact_email, appointment);
                }

                if (org.email_notification && admins.length > 0) {
                    for (const admin of admins) {
                        if (admin.email !== org.contact_email) {
                            await emailService.sendCancellationEmail(admin.email, appointment);
                        }
                    }
                }
            }
        } catch (e) { console.error('Notification/Email failed:', e); }

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
                    "UPDATE appointments SET status = 'serving', updated_at = NOW() WHERE id = $1",
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

        // Notifications logic...
        const user = await userModel.getUserById(appointment.user_id);
        const orgRes = await pool.query('SELECT name, contact_email, email_notification, new_booking_notification FROM organizations WHERE id = $1', [orgId]);
        const org = orgRes.rows[0];

        if (user && user.email && user.email_notification_enabled !== false) {
            await emailService.sendStatusUpdateEmail(user.email, { ...appointment, status });
        }

        await notificationService.sendNotification(
            appointment.user_id,
            'Appointment Updated',
            `Your ticket for ${appointment.service_name} is now ${status}.`,
            'appointment',
            `/appointments`
        );

        // 2. Notify Admins
        if (org && org.new_booking_notification) {
            const admins = await userModel.getAdminsByOrg(orgId);
            const adminMessage = `Status of ${user?.name || 'User'}'s appointment for ${appointment.service_name} updated to ${status}.`;

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
            if (org.email_notification && org.contact_email) {
                await emailService.sendStatusUpdateEmail(org.contact_email, { ...appointment, status });
            }

            if (org.email_notification && admins.length > 0) {
                for (const admin of admins) {
                    if (admin.email !== org.contact_email) {
                        await emailService.sendStatusUpdateEmail(admin.email, { ...appointment, status });
                    }
                }
            }
        }
    } catch (e) { console.error('Socket/Notification failed:', e); }

    return updatedAppointment;
};


const getUserAppointments = async (userId) => {
    return appointmentModel.getAppointmentsByUserId(userId);
};

const getQueueStatus = async (appointmentId) => {
    // 1. Get Appointment details
    const appointment = await appointmentModel.getAppointmentById(appointmentId);
    if (!appointment) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');
    }

    // 2. Fetch service details for ranking logic and timing
    const { rows: [service] } = await pool.query(
        'SELECT queue_type, estimated_service_time, queue_scope FROM services WHERE id = $1',
        [appointment.service_id]
    );

    // 3. Dynamic Ranking Query (Matches partitioning logic)
    const partitionQuery = `
        CASE 
            WHEN service.queue_scope = 'PER_RESOURCE' THEN a.slot_id::text 
            ELSE (SELECT CONCAT(a.service_id, '_', sl.start_time) FROM slots sl WHERE sl.id = a.slot_id)
        END
    `;

    const filterClause = appointment.slot_id
        ? (service.queue_scope === 'PER_RESOURCE'
            ? 'a.slot_id = $1'
            : 'a.service_id = $1 AND (SELECT start_time FROM slots WHERE id = a.slot_id) = (SELECT start_time FROM slots WHERE id = $2)')
        : 'a.service_id = $1 AND DATE(a.created_at) = DATE($2)';

    const filterParams = (appointment.slot_id && service.queue_scope !== 'PER_RESOURCE')
        ? [appointment.service_id, appointment.slot_id]
        : [appointment.slot_id || appointment.service_id, appointment.slot_id ? undefined : appointment.created_at].filter(p => p !== undefined);

    const { rows: rankedRows } = await pool.query(
        `WITH RankedQueue AS (
            SELECT 
                a.id, 
                a.status, 
                ROW_NUMBER() OVER (PARTITION BY ${partitionQuery} ORDER BY a.created_at ASC) as q_rank
            FROM appointments a
            JOIN services service ON a.service_id = service.id
            WHERE a.status IN ('serving', 'pending', 'confirmed', 'completed')
            AND ${filterClause}
         )
         SELECT * FROM RankedQueue`,
        filterParams
    );

    const myEntry = rankedRows.find(r => r.id === appointmentId);
    const myRank = myEntry ? parseInt(myEntry.q_rank) : 0;

    // 4. Calculate Current Serving (The rank of the entry with 'serving' status, else the MIN active)
    const servingEntry = rankedRows.find(r => r.status === 'serving');
    let currentServingNumber;

    if (servingEntry) {
        currentServingNumber = parseInt(servingEntry.q_rank);
    } else {
        const activeRanks = rankedRows
            .filter(r => ['pending', 'confirmed'].includes(r.status))
            .map(r => parseInt(r.q_rank));
        currentServingNumber = activeRanks.length > 0 ? Math.min(...activeRanks) : myRank;
    }

    const peopleAhead = Math.max(0, myRank - currentServingNumber);

    // 5. Calculate Estimated Wait Time
    let estimatedWaitMinutes = 0;

    if (service.queue_type === 'STATIC') {
        estimatedWaitMinutes = peopleAhead * (service.estimated_service_time || 15);
    } else {
        // DYNAMIC: Average of last 10 completed appointments for this service/resource
        const { rows: [avgRes] } = await pool.query(
            `WITH RecentCompleted AS (
                 SELECT a.updated_at, a.created_at
                 FROM appointments a
                 WHERE ${filterClause}
                 AND a.status = 'completed'
                 AND a.updated_at IS NOT NULL
                 ORDER BY a.updated_at DESC
                 LIMIT 10
             )
             SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/60) as avg_duration
             FROM RecentCompleted`,
            filterParams
        );
        const avgDuration = parseFloat(avgRes?.avg_duration) || service.estimated_service_time || 15;
        estimatedWaitMinutes = Math.round(peopleAhead * avgDuration);
    }

    return {
        queue_number: myRank, // legacy support
        myRank: myRank,
        current_serving_number: currentServingNumber,
        people_ahead: peopleAhead,
        estimated_wait_time: estimatedWaitMinutes,
        status: appointment.status
    };
};

module.exports = {
    bookAppointment,
    cancelAppointment,
    updateAppointmentStatus,
    getUserAppointments,
    getQueueStatus,
    advanceQueueAutomatically
};
