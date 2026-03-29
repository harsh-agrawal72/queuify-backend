// backend/src/controllers/wallet.controller.js
const httpStatus = require('../utils/httpStatus');
const catchAsync = require('../utils/catchAsync');
const walletService = require('../services/wallet.service');
const ApiError = require('../utils/ApiError');

const getWalletStatus = catchAsync(async (req, res) => {
    const orgId = req.user.org_id;
    if (!orgId) {
        throw new ApiError(httpStatus.FORBIDDEN, 'Only organization administrators can access wallet details');
    }

    const wallet = await walletService.getWalletByOrgId(orgId);
    if (!wallet) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Wallet not found for this organization');
    }

    res.status(httpStatus.OK).send(wallet);
});

const getTransactionHistory = catchAsync(async (req, res) => {
    const orgId = req.user.org_id;
    if (!orgId) {
        throw new ApiError(httpStatus.FORBIDDEN, 'Only organization administrators can access transaction history');
    }

    const { limit = 50, offset = 0 } = req.query;
    const transactions = await walletService.getTransactionHistory(orgId, parseInt(limit), parseInt(offset));
    
    res.status(httpStatus.OK).send(transactions);
});

const requestPayout = catchAsync(async (req, res) => {
    const orgId = req.user.org_id;
    if (!orgId) {
        throw new ApiError(httpStatus.FORBIDDEN, 'Only organization administrators can request payouts');
    }

    const { amount, bankDetails } = req.body;
    const payout = await walletService.requestPayout(orgId, amount, bankDetails);
    
    res.status(httpStatus.CREATED).send(payout);
});

const withdraw = catchAsync(async (req, res) => {
    const orgId = req.user.org_id;
    if (!orgId) {
        throw new ApiError(httpStatus.FORBIDDEN, 'Only organization administrators can initiate withdrawals');
    }

    const { amount } = req.body;
    const result = await require('../services/payout.service').withdrawToBank(orgId, parseFloat(amount));
    
    res.status(httpStatus.OK).send(result);
});

module.exports = {
    getWalletStatus,
    getTransactionHistory,
    requestPayout,
    withdraw
};
