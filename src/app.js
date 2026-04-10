const express = require('express');
const helmet = require('helmet');
const path = require('path');
const cors = require('cors');
const httpStatus = require('./utils/httpStatus');
const config = require('./config/config');
const { errorConverter, errorHandler } = require('./middlewares/error');
const ApiError = require('./utils/ApiError');
const routes = require('./routes/v1');

const compression = require('compression');
const { xss } = require('express-xss-sanitizer');
const logger = require('./config/morgan');
const { authLimiter, apiLimiter } = require('./middlewares/rateLimiter');

const app = express();

// Trust proxy - Required for Render/Cloud environments
app.set('trust proxy', 1);

// Explicit Global Logger
app.use((req, res, next) => {
    console.log(`[Global Request] ${req.method} ${req.originalUrl}`);
    next();
});

// Logging
if (config.env !== 'test') {
    app.use(logger.successHandler);
    app.use(logger.errorHandler);
}

// Force HTTPS in production (Render sends x-forwarded-proto)
// if (config.env === 'production') {
//     app.use((req, res, next) => {
//         if (req.headers['x-forwarded-proto'] !== 'https') {
//             return res.redirect(`https://${req.get('Host')}${req.url}`);
//         }
//         return next();
//     });
// }



const allowedOrigins = [
    "https://queuify.onrender.com",
    "https://queuify.in",
    "https://www.queuify.in",
    "https://queuify-backend.onrender.com",
    "http://localhost:5173",
];

// Production-ready CORS setup with prefix matching for subdomains
const corsOptions = {
    origin: function (origin, callback) {
        // allow requests with no origin (like mobile apps or curl requests)
        if (!origin) {
            return callback(null, true);
        }

        const isAllowed = allowedOrigins.some(base => origin.startsWith(base));
        if (isAllowed) {
            callback(null, true);
        } else {
            console.warn(`[CORS] Rejected origin: ${origin}`);
            // Do not pass an Error to the callback, as it results in a 500 error for preflight
            callback(null, false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'X-Requested-With', 'Accept', 'Access-Control-Allow-Origin'],
    optionsSuccessStatus: 200 // Some legacy browsers choke on 204
};

app.use(cors(corsOptions));
// Handle OPTIONS preflight for all routes
app.options('*', cors(corsOptions));

// Security headers
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }
}));


// Parse JSON
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rate limiting (only in production)
if (config.env === 'production') {
    app.use('/v1/auth', authLimiter);
    app.use('/v1', apiLimiter);
}

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', uptime: process.uptime() });
});

// Monitoring
const { monitoringMiddleware, errorLoggingMiddleware } = require('./middlewares/monitoring');
app.use(monitoringMiddleware);

// API routes
app.use('/v1', routes);

// 404 handler
app.use((req, res, next) => {
    next(new ApiError(httpStatus.NOT_FOUND, 'Not found'));
});

// Error handlers
app.use(errorLoggingMiddleware);
app.use(errorConverter);
app.use(errorHandler);

module.exports = app;
