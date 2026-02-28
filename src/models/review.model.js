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

const getReviewsByOrgId = async (orgId) => {
    const query = `
        SELECT r.*, u.name as user_name
        FROM reviews r
        JOIN users u ON r.user_id = u.id
        WHERE r.org_id = $1
        ORDER BY r.created_at DESC;
    `;
    const { rows } = await pool.query(query, [orgId]);
    return rows;
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
};
