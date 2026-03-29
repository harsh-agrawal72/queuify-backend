// backend/src/routes/v1/payment.route.js
const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const walletController = require('../../controllers/wallet.controller');
const Joi = require('joi');

const router = express.Router();

// ─── Wallet (Admin) ───
router.get('/status', auth('admin'), walletController.getWalletStatus);
router.get('/transactions', auth('admin'), walletController.getTransactionHistory);

const payoutValidation = {
    body: Joi.object().keys({
        amount: Joi.number().required().min(100),
        bankDetails: Joi.object().required().keys({
            accountHolder: Joi.string().required(),
            accountNumber: Joi.string().required(),
            ifsc: Joi.string().required()
        })
    })
};
router.post('/payout', auth('admin'), validate(payoutValidation), walletController.requestPayout);

// ─── Payment Gateway (Mock Razorpay) ───
const mockPaymentService = require('../../services/mockPayment.service');
const walletService = require('../../services/wallet.service');
const { pool } = require('../../config/db');

// Create payment order
router.post('/create-order', auth('user'), async (req, res) => {
    try {
        const { appointmentId, amount } = req.body;
        const order = await mockPaymentService.createOrder(appointmentId, amount);
        res.json({ success: true, order });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Verify payment and credit locked funds to org wallet
router.post('/verify-payment', auth('user'), async (req, res) => {
    try {
        const { appointmentId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        const isValid = mockPaymentService.verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
        if (!isValid) return res.status(400).json({ success: false, message: 'Invalid payment signature' });

        const apptRes = await pool.query(
            'SELECT id, org_id, price, payment_status FROM appointments WHERE id = $1',
            [appointmentId]
        );
        const appt = apptRes.rows[0];
        if (!appt) return res.status(404).json({ success: false, message: 'Appointment not found' });
        if (appt.payment_status === 'paid') return res.json({ success: true, message: 'Already paid' });

        await walletService.creditLockedFunds(appt.org_id, appt.price, appointmentId, 'Appointment booking payment');

        await pool.query(
            "UPDATE appointments SET payment_status = 'paid', status = 'confirmed', updated_at = NOW() WHERE id = $1",
            [appointmentId]
        );

        res.json({ success: true, message: 'Payment verified and escrow credited' });
    } catch (e) {
        console.error('[PaymentRoute] verify-payment error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ─── Refund Preview ───
const autoRefundService = require('../../services/autoRefund.service');

router.get('/refund-preview/:appointmentId', auth('user'), async (req, res) => {
    try {
        const preview = await autoRefundService.getRefundPreview(req.params.appointmentId, 'user');
        res.json({ success: true, ...preview });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
