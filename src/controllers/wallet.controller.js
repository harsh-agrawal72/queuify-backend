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

    const { limit = 10, offset = 0, search, type, status } = req.query;
    const transactions = await walletService.getTransactionHistory(orgId, {
        limit: parseInt(limit),
        offset: parseInt(offset),
        search,
        type,
        status
    });
    
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

const exportTransactionHistory = catchAsync(async (req, res) => {
    const orgId = req.user.org_id;
    if (!orgId) {
        throw new ApiError(httpStatus.FORBIDDEN, 'Only organization administrators can export transaction history');
    }

    const { search, type, status, startDate, endDate } = req.query;
    const transactions = await walletService.getTransactionHistoryForExport(orgId, {
        search,
        type,
        status,
        startDate,
        endDate
    });

    if (transactions.length === 0) {
        return res.status(httpStatus.OK).send("No transactions found for the selected filters.");
    }

    // Generate CSV
    const headers = Object.keys(transactions[0]);
    const csvRows = [];
    csvRows.push(headers.join(','));

    for (const row of transactions) {
        const values = headers.map(header => {
            const val = row[header];
            // Escape quotes and wrap in quotes if contains comma
            const escaped = ('' + (val || '')).replace(/"/g, '""');
            return `"${escaped}"`;
        });
        csvRows.push(values.join(','));
    }

    const csvString = csvRows.join('\n');
    const fileName = `transactions_${orgId}_${new Date().toISOString().split('T')[0]}.csv`;

    res.header('Content-Type', 'text/csv');
    res.attachment(fileName);
    res.status(httpStatus.OK).send(csvString);
});

module.exports = {
    getWalletStatus,
    getTransactionHistory,
    requestPayout,
    withdraw,
    exportTransactionHistory
};
