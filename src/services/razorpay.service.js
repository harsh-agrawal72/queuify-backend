// src/services/razorpay.service.js
const Razorpay = require('razorpay');
const crypto = require('crypto');
const ApiError = require('../utils/ApiError');
const httpStatus = require('../utils/httpStatus');

// Initialize Razorpay instance
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Create a new Razorpay order
 * @param {number} amount - Amount in paise (1 INR = 100 paise)
 * @param {string} currency - Currency (default: 'INR')
 * @param {string} receipt - Receipt identifier (e.g. appointment_id)
 * @returns {Promise<Object>}
 */
const createOrder = async (amount, currency = 'INR', receipt) => {
    try {
        const options = {
            amount: Math.round(amount), // must be an integer
            currency,
            receipt,
            payment_capture: 1 // auto capture
        };
        const order = await razorpay.orders.create(options);
        return order;
    } catch (error) {
        console.error('[RazorpayService] Create Order Error:', error);
        throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Error creating Razorpay order');
    }
};

/**
 * Verify Razorpay payment signature
 * @param {string} orderId 
 * @param {string} paymentId 
 * @param {string} signature 
 * @returns {boolean}
 */
const verifySignature = (orderId, paymentId, signature) => {
    const text = orderId + '|' + paymentId;
    const generated_signature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(text)
        .digest('hex');
    
    return generated_signature === signature;
};

module.exports = {
    createOrder,
    verifySignature,
    razorpayInstance: razorpay
};
