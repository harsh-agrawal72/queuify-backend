// backend/src/controllers/payment.controller.js
const httpStatus = require('../utils/httpStatus');
const catchAsync = require('../utils/catchAsync');
const razorpayService = require('../services/razorpay.service');
const walletService = require('../services/wallet.service');
const appointmentModel = require('../models/appointment.model');
const { pool } = require('../config/db');
const ApiError = require('../utils/ApiError');

/**
 * Step 1: Create Order
 * This happens before the checkout modal opens
 */
const createOrder = catchAsync(async (req, res) => {
    const { appointmentId } = req.body;
    
    // 1. Fetch appointment details (must be paid)
    const appointment = await appointmentModel.getAppointmentById(appointmentId);
    if (!appointment) throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');
    
    if (appointment.status === 'cancelled') throw new ApiError(httpStatus.BAD_REQUEST, 'Appointment is cancelled');

    const appointmentAmount = parseFloat(appointment.price);
    console.log(`[PaymentController] Appointment ${appointmentId} price: ${appointment.price} -> parsed: ${appointmentAmount}`);
    
    if (isNaN(appointmentAmount) || appointmentAmount <= 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, `Invalid appointment price: ${appointment.price}`);
    }

    // 2. Create Real Razorpay Order
    const amountInPaise = Math.round(appointmentAmount * 100);
    console.log(`[PaymentController] Creating order for ${amountInPaise} paise`);
    
    try {
        const order = await razorpayService.createOrder(amountInPaise, 'INR', `a_${appointmentId}`);
        console.log(`[PaymentController] Razorpay Order Created: ${order.id}`);
        res.status(httpStatus.OK).send({
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
            appointment_id: appointmentId
        });
    } catch (razorpayError) {
        console.error('[PaymentController] Razorpay order creation failed:', razorpayError.message);
        throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Razorpay Order Error: ${razorpayError.message}`);
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

    // 1. Verify Real Signature
    const isValid = razorpayService.verifySignature(
        razorpay_order_id, 
        razorpay_payment_id, 
        razorpay_signature
    );

    if (!isValid) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid payment signature');

    // 2. Update Appointment Status
    const appointment = await appointmentModel.getAppointmentById(appointmentId);
    if (!appointment) throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');

    await pool.query(
        "UPDATE appointments SET payment_status = 'paid', payment_id = $1, status = 'confirmed' WHERE id = $2",
        [razorpay_payment_id, appointmentId]
    );

    // 3. Credit Locked Funds to Org Wallet
    try {
        await walletService.creditLockedFunds(
            appointment.org_id, 
            parseFloat(appointment.price), 
            appointmentId, 
            `Payment for ${appointment.service_name}`
        );
    } catch (err) {
        console.error('[PaymentController] Wallet credit failed:', err.message);
        // We still return success to the user as the payment is confirmed
    }

    res.status(httpStatus.OK).send({
        success: true,
        message: 'Payment verified and appointment confirmed',
        appointment_id: appointmentId
    });
});

module.exports = {
    createOrder,
    verifyPayment
};
