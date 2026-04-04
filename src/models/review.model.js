const { pool } = require('../config/db');

const createReview = async (reviewData) => {
    const { org_id, user_id, appointment_id, rating, comment } = reviewData;
    const query = `
        INSERT INTO reviews (org_id, user_id, appointment_id, rating, comment)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *;
    `;
    const values = [org_id, user_id, appointment_id, rating, comment];
    const { rows } = await pool.query(query, values);
    return rows[0];
};

const getReviewsByOrgId = async (orgId, limit = 50, offset = 0) => {
    const query = `
        SELECT r.*, u.name as user_name
        FROM reviews r
        JOIN users u ON r.user_id = u.id
        WHERE r.org_id = $1
        ORDER BY r.created_at DESC
        LIMIT $2 OFFSET $3;
    `;
    const { rows } = await pool.query(query, [orgId, limit, offset]);
    return rows;
};

const getReviewsStatsByOrgId = async (orgId) => {
    const query = `
        SELECT 
            COUNT(*) as total_reviews,
            COALESCE(AVG(rating), 0) as average_rating
        FROM reviews 
        WHERE org_id = $1;
    `;
    const { rows } = await pool.query(query, [orgId]);
    return {
        totalReviews: parseInt(rows[0].total_reviews),
        averageRating: Number(Number(rows[0].average_rating).toFixed(1))
    };
};

const getReviewByAppointmentId = async (appointmentId) => {
    const query = `
        SELECT * FROM reviews WHERE appointment_id = $1;
    `;
    const { rows } = await pool.query(query, [appointmentId]);
    return rows[0];
};

module.exports = {
    createReview,
    getReviewsByOrgId,
    getReviewByAppointmentId,
    getReviewsStatsByOrgId
};
