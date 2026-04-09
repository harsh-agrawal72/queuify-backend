const { pool } = require('../config/db');
const httpStatus = require('../utils/httpStatus');
const ApiError = require('../utils/ApiError');

/**
 * Validate a coupon code
 * @param {string} code 
 * @param {string} role - 'admin', 'user'
 * @param {string} planId - optional plan id check
 * @returns {Promise<Object>}
 */
const validateCoupon = async (code, role) => {
    const res = await pool.query(
        `SELECT * FROM coupons 
         WHERE code = $1 AND is_active = TRUE`,
        [code]
    );

    const coupon = res.rows[0];

    if (!coupon) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Invalid coupon code');
    }

    // Check target role
    if (coupon.target_role !== 'all' && coupon.target_role !== role) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'This coupon is not valid for your account type');
    }

    // Check expiry
    if (coupon.expiry_date && new Date(coupon.expiry_date) < new Date()) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'This coupon has expired');
    }

    // Check usage limit
    if (coupon.usage_limit !== null && coupon.used_count >= coupon.usage_limit) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'This coupon usage limit has been reached');
    }

    return coupon;
};

/**
 * Calculate discounted amount
 */
const calculateDiscount = (originalAmount, coupon) => {
    let discount = 0;
    if (coupon.discount_type === 'percentage') {
        discount = (originalAmount * parseFloat(coupon.discount_value)) / 100;
    } else {
        discount = parseFloat(coupon.discount_value);
    }

    // Ensure discount doesn't exceed original amount
    discount = Math.min(discount, originalAmount);
    
    const finalAmount = Math.max(0, originalAmount - discount);

    return {
        originalAmount,
        discount,
        finalAmount: parseFloat(finalAmount.toFixed(2)),
        discountValue: coupon.discount_value,
        discountType: coupon.discount_type
    };
};

module.exports = {
    validateCoupon,
    calculateDiscount
};
