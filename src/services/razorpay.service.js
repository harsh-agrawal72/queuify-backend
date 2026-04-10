// src/services/razorpay.service.js
const Razorpay = require('razorpay');
const crypto = require('crypto');
const axios = require('axios');
const config = require('../config/config');
const ApiError = require('../utils/ApiError');
const httpStatus = require('../utils/httpStatus');

let razorpayInstance = null;

const getRazorpayInstance = () => {
    if (razorpayInstance) return razorpayInstance;

    const keyId = config.razorpay.keyId;
    const keySecret = config.razorpay.keySecret;

    console.log(`[RazorpayService] Initializing instance with Key ID: ${keyId ? keyId.substring(0, 10) + '...' : 'MISSING'}`);

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
            receipt: receipt || `r_${Math.floor(Date.now() / 1000)}`
        };

        console.log(`[RazorpayService] Executing rzp.orders.create with options:`, JSON.stringify(options));
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

/**
 * Refund a Razorpay payment
 * @param {string} paymentId 
 * @param {number} amount - Amount in Rupees
 * @param {Object} notes - Optional notes
 * @returns {Promise<Object>}
 */
const refundPayment = async (paymentId, amount, notes = {}) => {
    try {
        const rzp = getRazorpayInstance();
        // Convert to paise and ensure it's an integer
        const amountInPaise = Math.round(amount * 100);

        console.log(`[RazorpayService] Initiating refund: paymentId=${paymentId}, amount=${amount} (₹)`);

        // Handle Mock Payments
        if (paymentId && (paymentId.startsWith('pay_mock_') || paymentId.startsWith('order_mock_') || paymentId.startsWith('rfnd_mock_'))) {
            const mockPaymentService = require('./mockPayment.service');
            console.log(`[RazorpayService] Mock Payment Detected. Using mockPaymentService for refund.`);
            return await mockPaymentService.initiateRefund(paymentId, amountInPaise);
        }

        const refund = await rzp.payments.refund(paymentId, {
            amount: amountInPaise,
            speed: 'normal',
            notes: {
                ...notes,
                platform: 'queuify'
            }
        });

        console.log(`[RazorpayService] Refund successful: refundId=${refund.id}`);
        return refund;
    } catch (error) {
        console.error('[RazorpayService] Refund API Error:', error.message || error);
        throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Razorpay Refund Error: ${error.message || 'Unknown error'}`);
    }
};

/**
 * Process a RazorpayX Test Payout
 * Dynamically creates a Contact, Fund Account, and executes a Payout.
 * Uses test keys to simulate a payout to bank_details.
 */
const processPayout = async (amount, bankDetails, referenceId, orgDetails) => {
    try {
        const keyId = config.razorpay.keyId;
        const keySecret = config.razorpay.keySecret;
        const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${auth}`
        };

        console.log(`[RazorpayX] Starting payout process for Reference ID: ${referenceId}`);

        // 1. Create Contact
        const contactPayload = {
            name: orgDetails.name || 'Admin Vendor',
            email: orgDetails.contact_email || 'admin@queuify.com',
            contact: '9999999999', // Mock phone
            type: 'vendor',
            reference_id: `org_${orgDetails.id}`
        };

        const contactRes = await axios.post('https://api.razorpay.com/v1/contacts', contactPayload, { headers });
        const contactId = contactRes.data.id;
        console.log(`[RazorpayX] Created Contact: ${contactId}`);

        // 2. Create Fund Account
        const fundAccountPayload = {
            contact_id: contactId,
            account_type: 'bank_account',
            bank_account: {
                name: bankDetails.accountHolder || bankDetails.name || orgDetails.name,
                ifsc: bankDetails.ifsc,
                account_number: bankDetails.accountNumber
            }
        };

        const fundAccountRes = await axios.post('https://api.razorpay.com/v1/fund_accounts', fundAccountPayload, { headers });
        const fundAccountId = fundAccountRes.data.id;
        console.log(`[RazorpayX] Created Fund Account: ${fundAccountId}`);

        // 3. Create Payout
        const payoutPayload = {
            account_number: '2323230046581456', // Razorpay Test Mode Default Payout Account (or omit and rely on standard config)
            fund_account_id: fundAccountId,
            amount: Math.round(amount * 100), // In paise
            currency: 'INR',
            mode: 'IMPS',
            purpose: 'payout',
            queue_if_low_balance: true,
            reference_id: referenceId,
            narration: 'Queuify Wallet Withdrawal'
        };

        try {
            const payoutRes = await axios.post('https://api.razorpay.com/v1/payouts', payoutPayload, { headers });
            console.log(`[RazorpayX] Payout Successful: ${payoutRes.data.id}`);
            return payoutRes.data;
        } catch (err) {
            // Razorpay test mode requires account_number. If explicit account_number fails, try omitting it.
            if (err.response && err.response.data && err.response.data.error) {
                console.log(`[RazorpayX] First payout attempt failed: ${err.response.data.error.description}. Retrying without account_number...`);
                delete payoutPayload.account_number;
                const retryRes = await axios.post('https://api.razorpay.com/v1/payouts', payoutPayload, { headers });
                console.log(`[RazorpayX] Payout Successful on retry: ${retryRes.data.id}`);
                return retryRes.data;
            }
            throw err;
        }
    } catch (error) {
        console.log(`[RazorpayX] Detection: env=${config.env}`);
        const errorMsg = error.response?.data?.error?.description || (typeof error.response?.data === 'string' ? error.response.data : null) || error.message;

        const isNotFoundError = error.response?.status === 404 ||
            (typeof errorMsg === 'string' && errorMsg.toLowerCase().includes('not found on the server')) ||
            (error.message && error.message.includes('404'));

        const isNotProduction = config.env !== 'production';
        const isTestKey = config.razorpay.keyId && config.razorpay.keyId.startsWith('rzp_test_');

        if (isNotFoundError && (isNotProduction || isTestKey)) {
            console.log(`[RazorpayX] 404/Not Found Error detected in ${config.env} mode. This usually means RazorpayX is not enabled for your account.`);
            console.log(`[RazorpayX] Error message caught: "${errorMsg}"`);
            console.log(`[RazorpayX] Falling back to Mock Payout for development/testing...`);
            return {
                id: `pout_mock_${Math.random().toString(36).substr(2, 9)}`,
                status: 'processed',
                amount: Math.round(amount * 100),
                currency: 'INR',
                reference_id: referenceId,
                mode: 'IMPS',
                purpose: 'payout',
                notes: { mock: true }
            };
        }

        console.error('[RazorpayX] Complete Payout Flow Error:', errorMsg);
        if (error.response) {
            console.error('[RazorpayX] Error Details:', JSON.stringify(error.response.data, null, 2));
        }
        throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `RazorpayX Error: ${errorMsg}`);
    }
};

module.exports = {
    createOrder,
    verifySignature,
    getRazorpayInstance,
    refundPayment,
    processPayout
};
