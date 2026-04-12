// backend/src/controllers/payment.controller.js
const httpStatus = require('../utils/httpStatus');
const catchAsync = require('../utils/catchAsync');
const razorpayService = require('../services/razorpay.service');
const walletService = require('../services/wallet.service');
const planService = require('../services/plan.service');
const couponService = require('../services/coupon.service');
const appointmentModel = require('../models/appointment.model');
const { pool } = require('../config/db');
const ApiError = require('../utils/ApiError');
const { GST_RATE } = require('../utils/paymentHelper');

const { calculatePaymentBreakdown } = require('../utils/paymentHelper');

/**
 * Step 1: Create Order
 * This happens before the checkout modal opens
 */
const createOrder = catchAsync(async (req, res) => {
    const { appointmentId } = req.body;

    // 1. Fetch appointment details with concurrency guard
    const appointment = await appointmentModel.getAppointmentById(appointmentId);
    if (!appointment) throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');

    // Guard: Reject order creation if already paid (idempotency) or cancelled
    if (appointment.payment_status === 'paid') {
        console.warn(`[PaymentController] Duplicate createOrder blocked — Appt ${appointmentId} already paid.`);
        throw new ApiError(httpStatus.CONFLICT, 'This appointment has already been paid for.', true);
    }
    if (appointment.status === 'cancelled') {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Appointment has been cancelled and cannot be paid for.', true);
    }

    const appointmentAmount = parseFloat(appointment.price);
    console.log(`[PaymentController] Appointment ${appointmentId} price: ${appointment.price} -> parsed: ${appointmentAmount}`);

    if (isNaN(appointmentAmount) || appointmentAmount <= 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, `Invalid appointment price: ${appointment.price}`);
    }

    // 2. Ensure we have a valid breakdown (Recalculate if missing or 0)
    let finalBreakdown = {
        basePrice: appointment.price,
        platformFee: appointment.platform_fee,
        transactionFee: appointment.transaction_fee,
        paymentGst: appointment.payment_gst,
        totalPayable: appointment.total_payable
    };

    if (!finalBreakdown.totalPayable || parseFloat(finalBreakdown.totalPayable) <= 0) {
        console.log(`[PaymentController] Stored total_payable is missing/zero. Recalculating...`);
        const calculated = calculatePaymentBreakdown(appointmentAmount);
        finalBreakdown = {
            basePrice: calculated.basePrice,
            platformFee: calculated.platformFee,
            transactionFee: calculated.transactionFee,
            paymentGst: calculated.paymentGst,
            totalPayable: calculated.totalPayable
        };
    }

    // 3. Create Razorpay Order using TOTAL PAYABLE (base + platform fees + GST)
    const totalAmount = parseFloat(finalBreakdown.totalPayable);

    if (isNaN(totalAmount) || totalAmount <= 0) {
        console.error(`[PaymentController] Invalid total amount for appointment ${appointmentId}: ${finalBreakdown.totalPayable}`);
        throw new ApiError(httpStatus.BAD_REQUEST, `Invalid total payable amount: ${finalBreakdown.totalPayable}`);
    }

    const amountInPaise = Math.round(totalAmount * 100);
    console.log(`[PaymentController] Creating order for Appointment ${appointmentId}: Base=${appointmentAmount}, Total=${totalAmount} (${amountInPaise} paise)`);

    try {
        const receiptId = `a_${String(appointmentId).substring(0, 30)}`;
        const order = await razorpayService.createOrder(amountInPaise, 'INR', receiptId, {
            appointment_id: appointmentId,
            user_id: req.user.id,
            type: 'appointment'
        });

        // 4. Store Order ID in DB for reconciliation
        await pool.query('UPDATE appointments SET razorpay_order_id = $1 WHERE id = $2', [order.id, appointmentId]);

        console.log(`[PaymentController] Razorpay Order Created: ${order.id} for appt ${appointmentId}`);
        res.status(httpStatus.OK).send({
            order: {
                id: order.id,
                amount: order.amount,
                currency: order.currency
            },
            appointment_id: appointmentId,
            breakdown: finalBreakdown
        });
    } catch (razorpayError) {
        console.error('[PaymentController] Razorpay order creation failed. Error:', razorpayError);
        throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Razorpay Order Error: ${razorpayError.message}`, true);
    }
});

/**
 * Step 2: Verify Payment
 * This happens after user 'pays' in the checkout modal
 */
const verifyPayment = catchAsync(async (req, res) => {
    const {
        appointmentId,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
    } = req.body;

    // ── STEP 1: Verify signature BEFORE acquiring the DB lock ──
    // This prevents a slow Razorpay API call from holding the row lock.
    const isMockOrder = razorpay_order_id && razorpay_order_id.startsWith('order_mock_');
    const isMockPayment = razorpay_payment_id && razorpay_payment_id.startsWith('pay_mock_');

    if (!isMockOrder && !isMockPayment) {
        const isValid = razorpayService.verifySignature(
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature
        );
        if (!isValid) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid payment signature');
    } else {
        console.log(`[PaymentController] Mock payment detected for appt ${appointmentId}. Skipping signature verification.`);
    }

    // ── STEP 2: Acquire a row-level lock (FOR UPDATE) ──
    // This serializes concurrent verify calls for the same appointment.
    // If two requests arrive simultaneously, the second waits until the
    // first commits, then reads the updated state and exits idempotently.
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log(`[PaymentController] verifyPayment init: appt=${appointmentId}, order=${razorpay_order_id}`);

        // Lock the row — concurrent calls block here until first completes
        const { rows } = await client.query(
            "SELECT * FROM appointments WHERE id = $1::uuid FOR UPDATE",
            [appointmentId]
        );

        if (rows.length === 0) {
            console.error(`[PaymentController] Appt ${appointmentId} NOT FOUND`);
            await client.query('ROLLBACK');
            throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');
        }

        const appointment = rows[0];
        console.log(`[PaymentController] Appt record lock acquired. Status: ${appointment.status}, PaymentStatus: ${appointment.payment_status}`);

        // ── IDEMPOTENCY: Already paid (second verify call) ──
        if (appointment.payment_status === 'paid') {
            await client.query('ROLLBACK');
            console.log(`[PaymentController] Idempotent verify: Appt ${appointmentId} already confirmed. Returning success.`);
            return res.status(httpStatus.OK).send({
                success: true,
                message: 'Payment already confirmed',
                appointment_id: appointmentId
            });
        }

        // ── CANCEL RACE GUARD: Admin cancelled after order was created ──
        if (appointment.status === 'cancelled') {
            await client.query('ROLLBACK');
            console.warn(`[PaymentController] Payment verify rejected — Appt ${appointmentId} was cancelled by admin.`);
            throw new ApiError(httpStatus.CONFLICT, 'This appointment was cancelled. Your payment will be refunded if charged.', true);
        }

        const finalPaymentId = razorpay_payment_id || `pay_mock_${Math.random().toString(36).substring(2, 10)}`;

        // ── STEP 3: Confirm payment atomically ──
        console.log(`[PaymentController] Updating status to confirmed (enum cast)`);
        await client.query(
            "UPDATE appointments SET payment_status = 'paid', payment_id = $1, status = 'confirmed'::appointment_status, updated_at = NOW() WHERE id = $2::uuid",
            [finalPaymentId, appointmentId]
        );

        // ── STEP 3.5: Calculate Queue Rank (Ticket Number) ──
        let queueNumber = 0;
        try {
            console.log(`[PaymentController] Calculating live rank...`);
            queueNumber = await appointmentModel.getAppointmentRank(appointmentId, client);
            console.log(`[PaymentController] Rank calculated: ${queueNumber}`);
        } catch (rankErr) {
            console.error(`[PaymentController] Failed to calculate rank:`, rankErr.stack || rankErr.message);
        }

        // ── STEP 4: Credit locked funds to Org Wallet (base price only) ──
        const basePrice = parseFloat(appointment.price);
        try {
            console.log(`[PaymentController] Crediting wallet for Appointment ${appointmentId}: Base Price = ₹${basePrice}`);
            await walletService.creditLockedFunds(
                appointment.org_id,
                basePrice,
                appointmentId,
                `Payment for ${appointment.service_name || 'Service'}`,
                client  // pass the same client so wallet credit is in the same transaction
            );
        } catch (walletErr) {
            // Wallet credit failure should NOT block payment confirmation
            // Log it — the settlement cron will catch any missed credits
            console.error(`[PaymentController] Wallet credit failed for Appt ${appointmentId}:`, walletErr.message);
        }

        await client.query('COMMIT');
        console.log(`[PaymentController] Transaction committed for Appt ${appointmentId}`);

        // ── STEP 6: Post-Payment Logic (Notifications & Real-time Broadcast) ──
        try {
            console.log(`[PaymentController] Triggering post-payment notifications...`);
            const appointmentService = require('../services/appointment.service');
            appointmentService.finalizeBookingNotifications(appointmentId, queueNumber);
            console.log(`[PaymentController] Notifications trigger called successfully`);
        } catch (notifyErr) {
            console.error(`[PaymentController] Notification trigger failed:`, notifyErr.stack || notifyErr.message);
        }

        res.status(httpStatus.OK).send({
            success: true,
            message: 'Payment verified and appointment confirmed',
            appointment_id: appointmentId,
            queue_number: queueNumber
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        throw err;
    } finally {
        client.release();
    }
});

/**
 * Step 1: Create Plan Payment Order
 */
const createPlanOrder = catchAsync(async (req, res) => {
    const { planId, couponCode, duration = 1 } = req.body;
    const months = parseInt(duration) || 1;

    const plan = await planService.getPlanById(planId);
    if (!plan) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Plan not found');
    }

    // Role check: Only allow users to buy 'user' plans and admins to buy 'admin' plans
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
    if (!isAdmin && plan.target_role !== 'user') {
        throw new ApiError(httpStatus.FORBIDDEN, 'You cannot subscribe to an organization plan');
    }
    if (isAdmin && plan.target_role === 'user') {
        // Allow admins to buy user plans for themselves if they want, 
        // but usually they care about the org plan.
        // For now, let's just make sure the plan exists.
    }

    let pricePerMonth = parseFloat(plan.price_monthly);
    if (pricePerMonth <= 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Free plans do not require payment');
    }

    // 1. Calculate base aggregate price
    let baseAggregatePrice = pricePerMonth * months;

    // 2. Apply Multi-Month Discounts
    let multiMonthDiscountAmount = 0;
    let multiMonthDiscountRate = 0;

    if (months === 3) multiMonthDiscountRate = 0.05; // 5% off
    else if (months === 6) multiMonthDiscountRate = 0.10; // 10% off
    else if (months === 12) multiMonthDiscountRate = 0.20; // 20% off

    if (multiMonthDiscountRate > 0) {
        multiMonthDiscountAmount = parseFloat((baseAggregatePrice * multiMonthDiscountRate).toFixed(2));
    }

    let discountedPrice = baseAggregatePrice - multiMonthDiscountAmount;

    // --- COUPON LOGIC ---
    let discountInfo = null;
    let finalBasePrice = discountedPrice;

    if (couponCode) {
        try {
            const coupon = await couponService.validateCoupon(couponCode, plan.target_role);
            const breakdown = couponService.calculateDiscount(discountedPrice, coupon);
            finalBasePrice = breakdown.finalAmount;
            discountInfo = {
                code: coupon.code,
                discount: breakdown.discount,
                type: breakdown.discountType,
                value: breakdown.discountValue,
                multiMonthDiscount: multiMonthDiscountAmount,
                duration: months
            };
        } catch (e) {
            console.warn(`[PlanOrder] Coupon validation failed for ${couponCode}: ${e.message}`);
            // If coupon fails, we just proceed without discount (or we could throw error)
            // throwing error is better for UX so they don't accidentally pay full price
            throw e;
        }
    }

    // --- TAX CALCULATION (GST 18%) ---
    const gstAmount = parseFloat((finalBasePrice * GST_RATE).toFixed(2));
    const totalPayable = parseFloat((finalBasePrice + gstAmount).toFixed(2));

    // --- CHECK FOR 100% DISCOUNT (FREE) ---
    if (totalPayable <= 0) {
        return res.status(httpStatus.OK).send({
            isFree: true,
            message: 'Plan is free with this coupon',
            breakdown: {
                basePrice: baseAggregatePrice,
                discount: baseAggregatePrice,
                gst: 0,
                total: 0
            }
        });
    }

    const amountInPaise = Math.round(totalPayable * 100);
    const receiptId = `p_${String(planId).substring(0, 8)}_${Date.now()}`;

    // Store duration in notes so we can retrieve it during verification
    const order = await razorpayService.createOrder(amountInPaise, 'INR', receiptId, {
        plan_id: planId,
        duration: String(months),
        org_id: req.user.org_id || '',
        user_id: req.user.id,
        type: 'plan'
    });

    res.status(httpStatus.OK).send({
        order: {
            id: order.id,
            amount: order.amount,
            currency: order.currency
        },
        plan: {
            id: plan.id,
            name: plan.name,
            originalPrice: baseAggregatePrice,
            finalBasePrice,
            gst: gstAmount,
            totalPayable
        },
        discount: discountInfo
    });
});

/**
 * Step 1.5: Verify Coupon (For display in UI)
 */
const validateCoupon = catchAsync(async (req, res) => {
    const { code, planId, duration = 1 } = req.body;
    const months = parseInt(duration) || 1;
    const plan = await planService.getPlanById(planId);
    if (!plan) throw new ApiError(httpStatus.NOT_FOUND, 'Plan not found');

    const coupon = await couponService.validateCoupon(code, plan.target_role);
    const originalPrice = parseFloat(plan.price_monthly);
    const baseAggregate = originalPrice * months;

    // Apply multi-month discount first
    let multiMonthDiscountRate = 0;
    if (months === 3) multiMonthDiscountRate = 0.05;
    else if (months === 6) multiMonthDiscountRate = 0.10;
    else if (months === 12) multiMonthDiscountRate = 0.20;

    const aggregateAfterMultiMonth = baseAggregate * (1 - multiMonthDiscountRate);

    // Then apply coupon discount
    const breakdown = couponService.calculateDiscount(aggregateAfterMultiMonth, coupon);

    // Calculate GST on discounted price
    const gst = parseFloat((breakdown.finalAmount * GST_RATE).toFixed(2));
    const total = parseFloat((breakdown.finalAmount + gst).toFixed(2));

    res.send({
        isValid: true,
        couponCode: coupon.code,
        discountAmount: breakdown.discount,
        finalPrice: breakdown.finalAmount,
        gst,
        total,
        discountValue: coupon.discount_value,
        discountType: coupon.discount_type
    });
});

/**
 * Handle 100% Free Plan Purchase (Bypass Razorpay)
 */
const claimFreePlan = catchAsync(async (req, res) => {
    const { planId, couponCode, duration = 1 } = req.body;
    const months = parseInt(duration) || 1;

    // 1. Fetch Plan
    const plan = await planService.getPlanById(planId);
    if (!plan) throw new ApiError(httpStatus.NOT_FOUND, 'Plan not found');

    const originalPrice = parseFloat(plan.price_monthly);
    let finalAmount = originalPrice;

    // 2. Validate Coupon if provided
    if (couponCode) {
        const coupon = await couponService.validateCoupon(couponCode, plan.target_role);
        const breakdown = couponService.calculateDiscount(originalPrice, coupon);
        finalAmount = breakdown.finalAmount;
    }

    // 3. Verify it's actually free (either natively or via coupon)
    if (finalAmount > 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'This plan is not free. Payment required.');
    }

    // 4. Upgrade/Downgrade
    if (plan.target_role === 'admin') {
        if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
            throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
        }
        await planService.assignPlanToOrg(req.user.org_id, planId, months);
    } else {
        await planService.assignPlanToUser(req.user.id, planId, months);
    }

    // 5. Mark coupon as used if applied
    if (couponCode) {
        await pool.query('UPDATE coupons SET used_count = used_count + 1 WHERE code = $1', [couponCode]);
    }

    res.send({ success: true, message: 'Plan assigned successfully!' });
});

/**
 * Step 2: Verify Plan Payment & Upgrade
 */
const verifyPlanPayment = catchAsync(async (req, res) => {
    const {
        planId,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
    } = req.body;

    // 1. Verify Signature
    const isValid = razorpayService.verifySignature(
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
    );

    if (!isValid) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid payment signature');
    }

    // 2. Retrieve Duration from Order (Safety fallback)
    // In a real scenario, you'd fetch the order details from Razorpay to get the notes
    // Or just trust the frontend if passing duration there (less secure but easier for now)
    // Actually, let's fetch it from Razorpay service if possible, or just accept it in body
    const { duration = 1 } = req.body;
    const months = parseInt(duration) || 1;

    // 3. Upgrade Plan based on target_role
    const plan = await planService.getPlanById(planId);

    if (plan.target_role === 'admin') {
        // Ensure user is an admin of their org
        if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
            throw new ApiError(httpStatus.FORBIDDEN, 'Only organization admins can upgrade company plans');
        }
        await planService.assignPlanToOrg(req.user.org_id, planId, months);
    } else {
        await planService.assignPlanToUser(req.user.id, planId, months);
    }

    // 3. Log transaction or handle any additional logic here if needed

    res.status(httpStatus.OK).send({
        success: true,
        message: 'Plan upgraded successfully',
        plan_id: planId
    });
});

/**
 * Handle Subscription Restoration (Restoring a previously paid plan)
 */
const claimRestoration = catchAsync(async (req, res) => {
    const { planId } = req.body;
    const userModel = require('../models/user.model');

    // 1. Fetch current profile state
    const profile = await userModel.getUserById(req.user.id);
    if (!profile) throw new ApiError(httpStatus.NOT_FOUND, 'User not found');

    // 2. Determine if it's an Org or User restoration
    const isOrg = req.user.role === 'admin' || req.user.role === 'superadmin';
    const lastPaidPlanId = isOrg ? profile.last_paid_plan_id : profile.last_paid_plan_id; // Both populated in SELECT * or hydration
    const expiry = isOrg ? profile.last_paid_plan_expiry : profile.last_paid_plan_expiry;

    // 3. Validation
    if (!lastPaidPlanId || lastPaidPlanId !== planId) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'No previous subscription found for this plan');
    }

    if (!expiry || new Date(expiry) < new Date()) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Your previous subscription for this plan has expired. Please buy a new one.');
    }

    // 4. Restore the plan (bypass payment)
    if (isOrg) {
        const orgRes = await pool.query(
            'SELECT type as org_type, name as org_name, is_setup_completed as org_is_setup_completed, is_onboarded as org_is_onboarded, status as org_status, plan_id as org_plan_id, subscription_expiry, last_paid_plan_id, last_paid_plan_expiry FROM organizations WHERE id = $1',
            [req.user.org_id]
        );
        await pool.query(
            'UPDATE organizations SET plan_id = $1, subscription_expiry = $2, updated_at = NOW() WHERE id = $3',
            [planId, expiry, req.user.org_id]
        );
    } else {
        await pool.query(
            'UPDATE users SET plan_id = $1, subscription_expiry = $2, updated_at = NOW() WHERE id = $3',
            [planId, expiry, req.user.id]
        );
    }

    res.status(httpStatus.OK).send({
        success: true,
        message: 'Subscription restored successfully!',
        plan_id: planId
    });
});

/**
 * Step 3: Webhook Handler
 * Autonomous payment confirmation from Razorpay
 */
const handleWebhook = catchAsync(async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const secret = config.razorpay.webhookSecret;

    console.log(`[Webhook] Received Razorpay Webhook. Event: ${req.body.event}`);

    // 1. Validate Signature using RAW body
    const isValid = razorpayService.validateWebhookSignature(req.rawBody || req.body, signature, secret);
    if (!isValid) {
        console.error('[Webhook] Invalid webhook signature detected.');
        return res.status(httpStatus.BAD_REQUEST).send('Invalid signature');
    }

    const { event, payload } = req.body;

    // 2. Handle Payment Capture
    if (event === 'payment.captured') {
        const paymentEntity = payload.payment.entity;
        const notes = paymentEntity.notes || {};
        const paymentId = paymentEntity.id;
        const orderId = paymentEntity.order_id;

        console.log(`[Webhook] Processing captured payment ${paymentId} for ${notes.type || 'unknown type'}`);

        if (notes.type === 'appointment') {
            let appointmentId = notes.appointment_id;

            // FALLBACK: If notes.appointment_id is missing, find via razorpay_order_id column
            if (!appointmentId && orderId) {
                const fallbackRes = await pool.query(
                    "SELECT id FROM appointments WHERE razorpay_order_id = $1 LIMIT 1",
                    [orderId]
                );
                if (fallbackRes.rows.length > 0) {
                    appointmentId = fallbackRes.rows[0].id;
                    console.log(`[Webhook] Found appointment ${appointmentId} via order_id fallback (${orderId})`);
                }
            }

            if (!appointmentId) {
                console.error(`[Webhook] Cannot find appointment_id for order ${orderId}. Notes:`, notes);
                return res.status(httpStatus.OK).send({ status: 'ok', skipped: true, reason: 'no_appointment_id' });
            }

            // Check if already processed (Idempotency)
            const appt = await appointmentModel.getAppointmentById(appointmentId);
            if (appt && appt.payment_status === 'paid') {
                console.log(`[Webhook] Appointment ${appointmentId} already marked as paid. Skipping.`);
                return res.status(httpStatus.OK).send({ status: 'ok', already_processed: true });
            }

            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // Acquire lock
                const { rows } = await client.query(
                    "SELECT * FROM appointments WHERE id = $1::uuid FOR UPDATE",
                    [appointmentId]
                );

                if (rows.length > 0 && rows[0].payment_status !== 'paid') {
                    const appointment = rows[0];

                    // Update Status
                    await client.query(
                        "UPDATE appointments SET payment_status = 'paid', payment_id = $1, razorpay_order_id = $2, status = 'confirmed'::appointment_status, updated_at = NOW() WHERE id = $3::uuid",
                        [paymentId, orderId, appointmentId]
                    );

                    // Credit Wallet
                    const basePrice = parseFloat(appointment.price);
                    await walletService.creditLockedFunds(
                        appointment.org_id,
                        basePrice,
                        appointmentId,
                        `Payment for ${appt?.service_name || 'Service'} (via Webhook)`,
                        client
                    );

                    // Calculate Rank for notifications
                    const queueNumber = await appointmentModel.getAppointmentRank(appointmentId, client);

                    await client.query('COMMIT');

                    // Notifications
                    const appointmentService = require('../services/appointment.service');
                    appointmentService.finalizeBookingNotifications(appointmentId, queueNumber);
                } else {
                    await client.query('ROLLBACK');
                }
            } catch (err) {
                await client.query('ROLLBACK').catch(() => { });
                console.error(`[Webhook] Error processing appointment ${appointmentId}:`, err.message);
                // Return 500 so Razorpay retries
                return res.status(httpStatus.INTERNAL_SERVER_ERROR).send('Internal Server Error');
            } finally {
                client.release();
            }
        }
        else if (notes.type === 'plan') {
            const { planId, duration, user_id, org_id } = notes;
            const months = parseInt(duration) || 1;

            try {
                const plan = await planService.getPlanById(planId);
                if (plan) {
                    if (plan.target_role === 'admin' && org_id) {
                        await planService.assignPlanToOrg(org_id, planId, months);
                    } else if (user_id) {
                        await planService.assignPlanToUser(user_id, planId, months);
                    }
                    console.log(`[Webhook] Plan upgrade successful for ${notes.type} via Webhook`);
                }
            } catch (err) {
                console.error(`[Webhook] Error processing plan upgrade:`, err.message);
                return res.status(httpStatus.INTERNAL_SERVER_ERROR).send('Internal Server Error');
            }
        }
    }

    // Always return 200 to Razorpay
    res.status(httpStatus.OK).send({ status: 'ok' });
});

module.exports = {
    createOrder,
    verifyPayment,
    createPlanOrder,
    verifyPlanPayment,
    validateCoupon,
    claimFreePlan,
    claimRestoration,
    handleWebhook
};
