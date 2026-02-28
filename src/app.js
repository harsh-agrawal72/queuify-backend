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
if (config.env === 'production') {
    app.use((req, res, next) => {
        if (req.headers['x-forwarded-proto'] !== 'https') {
            return res.redirect(`https://${req.get('Host')}${req.url}`);
        }
        return next();
    });
}

const allowedOrigins = [
    "https://queuify.vercel.app",
    "http://localhost:5173", // optional for local dev
];

// Production-ready CORS setup
const corsOptions = {
    origin: function (origin, callback) {
        // allow requests with no origin (like mobile apps or curl requests)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS: " + origin));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'X-Requested-With', 'Accept']
};

app.use(cors(corsOptions));
// Handle OPTIONS preflight for all routes
app.options('*', cors(corsOptions));

// Security headers
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
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
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();

    res.json({
        status: 'healthy',
        uptime: Math.floor(uptime),
        serverTime: new Date().toISOString(),
        memoryUsage: {
            heapTotal: (memory.heapTotal / 1024 / 1024).toFixed(2) + ' MB',
            heapUsed: (memory.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
            rss: (memory.rss / 1024 / 1024).toFixed(2) + ' MB'
        },
        cpuUsage: cpu,
        nodeVersion: process.version
    });
});

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
