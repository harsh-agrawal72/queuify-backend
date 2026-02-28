const httpStatus = require('../utils/httpStatus');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');
const reviewModel = require('../models/review.model');
const appointmentModel = require('../models/appointment.model');

const submitReview = catchAsync(async (req, res) => {
    const { appointment_id, rating, comment } = req.body;
    const userId = req.user.id;

    // 1. Validate appointment
    const appointment = await appointmentModel.getAppointmentById(appointment_id);
    if (!appointment) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Appointment not found');
    }

    if (appointment.user_id !== userId) {
        throw new ApiError(httpStatus.FORBIDDEN, 'You can only review your own appointments');
    }

    if (appointment.status !== 'completed') {
        throw new ApiError(httpStatus.BAD_REQUEST, 'You can only review completed appointments');
    }

    // 2. Check if already reviewed
    const existingReview = await reviewModel.getReviewByAppointmentId(appointment_id);
    if (existingReview) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Appointment already reviewed');
    }

    // 3. Create review
    const review = await reviewModel.createReview({
        org_id: appointment.org_id,
        user_id: userId,
        appointment_id,
        rating,
        comment
    });

    res.status(httpStatus.CREATED).send(review);
});

const getOrgReviews = catchAsync(async (req, res) => {
    const { orgId } = req.params;
    const reviews = await reviewModel.getReviewsByOrgId(orgId);

    // Calculate aggregate (optional, but good for UI)
    const totalReviews = reviews.length;
    let averageRating = 0;
    if (totalReviews > 0) {
        const sum = reviews.reduce((acc, curr) => acc + curr.rating, 0);
        averageRating = Number((sum / totalReviews).toFixed(1));
    }

    res.status(httpStatus.OK).send({
        reviews,
        stats: {
            totalReviews,
            averageRating
        }
    });
});

module.exports = {
    submitReview,
    getOrgReviews
};
