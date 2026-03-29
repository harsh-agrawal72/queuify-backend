// src/services/razorpay.service.js
const Razorpay = require('razorpay');
const crypto = require('crypto');
const config = require('../config/config');
const ApiError = require('../utils/ApiError');
const httpStatus = require('../utils/httpStatus');

let razorpayInstance = null;

const getRazorpayInstance = () => {
    if (razorpayInstance) return razorpayInstance;

    const { keyId, keySecret } = config.razorpay;
    if (!keyId || !keySecret) {
        throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Razorpay configuration is missing. Please check your environment variables.');
    }

    razorpayInstance = new Razorpay({
        key_id: keyId,
        key_secret: keySecret,
    });
    return razorpayInstance;
};

const createOrder = async (amount, currency = 'INR', receipt) => {
    try {
        const rzp = getRazorpayInstance();
        const options = {
            amount: Math.round(amount), // must be an integer
            currency,
            receipt,
            payment_capture: 1 // auto capture
        };
        const order = await rzp.orders.create(options);
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
        .createHmac('sha256', config.razorpay.keySecret)
        .update(text)
        .digest('hex');
    
    return generated_signature === signature;
};

module.exports = {
    createOrder,
    verifySignature,
    getRazorpayInstance
};
