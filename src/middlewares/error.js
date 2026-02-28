const httpStatus = require('../utils/httpStatus');
const config = require('../config/config');
const ApiError = require('../utils/ApiError');

const errorConverter = (err, req, res, next) => {
    let error = err;
    if (!(error instanceof ApiError)) {
        const statusCode =
            err.statusCode && Number.isInteger(err.statusCode)
                ? err.statusCode
                : httpStatus.INTERNAL_SERVER_ERROR;

        const message = err.message || httpStatus[statusCode];

        error = new ApiError(statusCode, message, false, err.stack);
    }
    next(error);
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
    let { statusCode, message } = err;

    // Ensure statusCode is always a valid HTTP status
    if (!statusCode || typeof statusCode !== 'number' || statusCode < 100 || statusCode > 599) {
        statusCode = 500;
    }

    if (config.env === 'production' && !err.isOperational) {
        statusCode = httpStatus.INTERNAL_SERVER_ERROR;
        message = 'Internal Server Error';
    }

    res.locals.errorMessage = err.message;

    const response = {
        success: false,
        code: statusCode,
        message,
        ...(config.env === 'development' && { stack: err.stack }),
    };

    if (config.env === 'development') {
        console.error(err);
    }

    res.status(statusCode).json(response);
};

module.exports = {
    errorConverter,
    errorHandler,
};
