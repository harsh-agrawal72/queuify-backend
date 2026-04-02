/**
 * Payment Fee Calculation Utility
 * 
 * Logic:
 * Base Price (B) = Admin's Share
 * Platform Fee (P) = Queuify Net Share (₹5) platform_fee
 * Razorpay Fee Rate (R) = 0.02 (2%)
 * GST Rate (G) = 0.18 (18%)
 * 
 * We want X (Total Payable) such that:
 * X - (X * R * (1 + G)) - (P * (1 + G)) = B
 * X * (1 - 0.0236) = B + 5.90
 * X = (B + 5.90) / 0.9764
 */

const PLATFORM_FEE_NET = 5;
const GST_RATE = 0.18;
const RZP_FEE_RATE = 0.02;

const calculatePaymentBreakdown = (basePrice) => {
    const B = parseFloat(basePrice) || 0;
    if (B === 0) {
        return {
            basePrice: 0,
            platformFee: 0,
            transactionFee: 0,
            paymentGst: 0,
            totalPayable: 0
        };
    }

    // 1. Total Payable
    const totalPayable = (B + (PLATFORM_FEE_NET * (1 + GST_RATE))) / (1 - (RZP_FEE_RATE * (1 + GST_RATE)));
    
    // 2. Transaction Fee (Base 2% of total)
    const transactionFee = totalPayable * RZP_FEE_RATE;
    
    // 3. GST Components
    const platformGst = PLATFORM_FEE_NET * GST_RATE;
    const transactionGst = transactionFee * GST_RATE;
    const totalGst = platformGst + transactionGst;

    return {
        basePrice: parseFloat(B.toFixed(2)),
        platformFee: parseFloat(PLATFORM_FEE_NET.toFixed(2)),
        transactionFee: parseFloat(transactionFee.toFixed(2)),
        paymentGst: parseFloat(totalGst.toFixed(2)),
        totalPayable: parseFloat(totalPayable.toFixed(2))
    };
};

module.exports = {
    calculatePaymentBreakdown,
    PLATFORM_FEE_NET,
    GST_RATE,
    RZP_FEE_RATE
};
