// backend/src/routes/v1/payment.route.js
const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const walletController = require('../../controllers/wallet.controller');
const Joi = require('joi');

const router = express.Router();

// ─── Wallet (Admin & Staff) ───
router.get('/status', auth('admin', 'staff'), walletController.getWalletStatus);
router.get('/transactions', auth('admin', 'staff'), walletController.getTransactionHistory);
router.get('/transactions/export', auth('admin', 'staff'), walletController.exportTransactionHistory);
router.post('/withdraw', auth('admin'), walletController.withdraw);

const payoutValidation = {
    body: Joi.object().keys({
        amount: Joi.number().required().min(100),
        bankDetails: Joi.object().required().keys({
            accountHolder: Joi.string().required(),
            accountNumber: Joi.string().allow('', null),
            ifsc: Joi.string().allow('', null),
            bankName: Joi.string().allow('', null),
            upiId: Joi.string().allow('', null)
        }).or('accountNumber', 'upiId')
    })
};
router.post('/payout', auth('admin'), validate(payoutValidation), walletController.requestPayout);

const paymentController = require('../../controllers/payment.controller');

// Create payment order
router.post('/create-order', auth('user'), paymentController.createOrder);

// Verify payment and credit locked funds to org wallet
router.post('/verify-payment', auth('user'), paymentController.verifyPayment);

// Membership Plan Payments
router.post('/create-plan-order', auth('user', 'admin'), paymentController.createPlanOrder);
router.post('/verify-plan-payment', auth('user', 'admin'), paymentController.verifyPlanPayment);

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
