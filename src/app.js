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

app.get('/v1/diag/all', (req, res) => {
    const dns = require('dns');
    dns.lookup('smtp.gmail.com', { family: 4 }, async (err, address) => {
        try {
            const orgCols = await pool.query('SELECT column_name FROM information_schema.columns WHERE table_name = \'organizations\'').then(r => r.rows.map(ro => ro.column_name));
            
            res.json({
                timestamp: new Date().toISOString(),
                deploy_version: "3.0-robust-dns-proxy-v2",
                trust_proxy_setting: app.get('trust proxy'),
                env: config.env,
                smtp_config: {
                    host: config.email.smtp.host,
                    port: config.email.smtp.port,
                    has_user: !!config.email.smtp.user
                },
                dns_test: {
                    hostname: 'smtp.gmail.com',
                    resolved_ipv4: address || null,
                    error: err ? err.message : null
                },
                razorpay_status: {
                    has_key_id: !!config.razorpay.keyId,
                    key_id_prefix: config.razorpay.keyId ? config.razorpay.keyId.substring(0, 8) : null,
                    has_secret: !!config.razorpay.keySecret,
                    secret_length: config.razorpay.keySecret ? config.razorpay.keySecret.length : 0
                },
                db_schema: {
                    organizations_cols: orgCols
                },
                base_url: config.baseUrl,
                headers: req.headers
            });
        } catch (dbErr) {
            res.status(500).json({ error: dbErr.message, stack: dbErr.stack });
        }
    });
});

app.get('/v1/diag/test-razorpay', async (req, res) => {
    const razorpayService = require('./services/razorpay.service');
    try {
        const order = await razorpayService.createOrder(100, 'INR', `test_${Date.now().toString().slice(-10)}`);
        res.json({ success: true, orderId: order.id });
    } catch (err) {
        res.status(500).json({ 
            success: false, 
            message: err.message,
            full_error: err,
            key_id_prefix: config.razorpay.keyId ? config.razorpay.keyId.substring(0, 8) : null,
            env: config.env
        });
    }
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
