const Joi = require('joi');
const httpStatus = require('../utils/httpStatus');
const ApiError = require('../utils/ApiError');
const pick = require('../utils/pick');

const validate = (schema) => (req, res, next) => {
    // 1. Pick only the relevant parts from the schema
    const validSchema = pick(schema, ['params', 'query', 'body']);

    // 2. Pick only the corresponding parts from the request object
    const object = pick(req, Object.keys(validSchema));

    // 3. Validate against the schema
    const { value, error } = Joi.compile(validSchema)
        .prefs({ errors: { label: 'key' }, abortEarly: false })
        .validate(object);

    // 4. Handle validation errors
    if (error) {
        const errorMessage = error.details.map((details) => details.message).join(', ');
        console.error('Validation failed for:', req.originalUrl, 'Method:', req.method);
        console.error('Body received:', JSON.stringify(req.body, null, 2));
        console.error('Joi Error:', errorMessage);
        return next(new ApiError(httpStatus.BAD_REQUEST, errorMessage));
    }

    // 5. Update req parts safely (mutation instead of reassignment)
    // We only update what was present in the schema to avoid side effects
    Object.keys(validSchema).forEach((key) => {
        if (value[key] && req[key] && typeof req[key] === 'object') {
            Object.assign(req[key], value[key]);
        }
    });

    return next();
};

module.exports = validate;
