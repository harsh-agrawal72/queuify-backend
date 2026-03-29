// src/services/razorpay.service.js
const Razorpay = require('razorpay');
const crypto = require('crypto');
const config = require('../config/config');
const ApiError = require('../utils/ApiError');
const httpStatus = require('../utils/httpStatus');

let razorpayInstance = null;

const getRazorpayInstance = () => {
    if (razorpayInstance) return razorpayInstance;

    const keyId = config.razorpay.keyId;
    const keySecret = config.razorpay.keySecret;
    
    console.log(`[RazorpayService] Initializing with Key ID: ${keyId ? 'PRESENT' : 'MISSING'}`);

    if (!keyId || !keySecret) {
        throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Razorpay configuration (Key ID or Secret) is missing in environment variables.');
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
        console.log(`[RazorpayService] Creating order: amount=${amount}, currency=${currency}, receipt=${receipt}`);
        
        const options = {
            amount: Math.round(amount), // must be an integer (paise)
            currency,
            receipt,
            payment_capture: 1 
        };
        
        const order = await rzp.orders.create(options);
        return order;
    } catch (error) {
        console.error('[RazorpayService] Razorpay API Error:', error.message || error);
        // Rethrow with more context if it's a 500
        throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Razorpay API Error: ${error.message || 'Unknown error'}`);
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
