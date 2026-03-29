// backend/src/services/mockPayment.service.js
const crypto = require('crypto');

/**
 * Simulate Razorpay Order Creation
 * @param {number} amount - Amount in paise (e.g. 50000 for ₹500)
 * @param {string} currency - 'INR'
 * @param {string} receipt - Unique receipt ID
 */
const createOrder = async (amount, currency = 'INR', receipt) => {
    // In a real Razorpay call, this hits their API
    // Here we just return a realistic mock object
    return {
        id: `order_mock_${Math.random().toString(36).substring(2, 10)}`,
        entity: 'order',
        amount: amount,
        amount_paid: 0,
        amount_due: amount,
        currency: currency,
        receipt: receipt,
        status: 'created',
        created_at: Math.floor(Date.now() / 1000)
    };
};

/**
 * Simulate Razorpay Signature Verification
 * @param {string} orderId
 * @param {string} paymentId
 * @param {string} signature
 */
const verifySignature = async (orderId, paymentId, signature) => {
    // In real Razorpay, we'd do:
    // const generated_signature = crypto.createHmac('sha256', secret).update(orderId + "|" + paymentId).digest('hex');
    // return generated_signature === signature;

    // For Mock: We accept anything that isn't 'fail_signature'
    if (signature === 'fail_signature') return false;
    return true;
};

/**
 * Simulate Refund
 */
const initiateRefund = async (paymentId, amount) => {
    return {
        id: `rfnd_mock_${Math.random().toString(36).substring(2, 10)}`,
        entity: 'refund',
        amount: amount,
        payment_id: paymentId,
        status: 'processed',
        created_at: Math.floor(Date.now() / 1000)
    };
};

module.exports = {
    createOrder,
    verifySignature,
    initiateRefund
};
