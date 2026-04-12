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

// 1. Trust proxy - Required for Render/Cloud environments
app.set('trust proxy', 1);

// 2. CORS - VERY IMPORTANT: Must be FIRST to handle preflights during cold starts
const allowedOrigins = [
    "https://queuify.onrender.com",
    "https://queuify.in",
    "https://www.queuify.in",
    "https://queuify-backend.onrender.com",
    "http://localhost:5173",
];

const corsOptions = {
    origin: function (origin, callback) {
        // allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        // check if origin is allowed
        const isAllowed = allowedOrigins.some(base => origin.startsWith(base));
        if (isAllowed) {
            callback(null, true);
        } else {
            console.warn(`[CORS] Rejected origin: ${origin}`);
            callback(null, false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    optionsSuccessStatus: 200 // Some legacy browsers choke on 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// 3. Explicit Global Logger
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



// Security headers (moved after CORS)
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }
}));


// Parse JSON
// Parse JSON with raw body support for webhooks
app.use(express.json({ 
    limit: '20mb',
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
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
