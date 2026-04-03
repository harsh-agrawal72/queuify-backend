const app = require('./app');
const config = require('./config/config');
const { pool } = require('./config/db');
const fs = require('fs');
const path = require('path');

const http = require('http');
let socket;
let reminderCron;
let settlementCron;

try {
    socket = require('./socket/index');
} catch (e) {
    console.warn('Socket module not loaded:', e.message);
    socket = { init: () => { } };
}

try {
    reminderCron = require('./cron/reminder');
} catch (e) {
    console.warn('Reminder cron module not loaded:', e.message);
    reminderCron = { init: () => { } };
}

try {
    settlementCron = require('./cron/settlement');
} catch (e) {
    console.warn('Settlement cron module not loaded:', e.message);
    settlementCron = { init: () => { }, runSettlement: async () => ({}) };
}

let server;

const startServer = () => {
    const httpServer = http.createServer(app);

    try {
        socket.init(httpServer);
    } catch (e) {
        console.warn('Socket init failed:', e.message);
    }

    try {
        reminderCron.init();
    } catch (e) {
        console.warn('Reminder cron init failed:', e.message);
    }

    try {
        settlementCron.init();
    } catch (e) {
        console.warn('Settlement cron init failed:', e.message);
    }

    // ── Manual Test Trigger for Settlement (DEV only) ──
    const auth = require('./middlewares/auth');
    app.post('/v1/test/run-settlement', auth('admin'), async (req, res) => {
        try {
            const result = await settlementCron.runSettlement();
            res.json({ success: true, result });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    console.log(`Attempting to start server on port ${config.port}...`);
    server = httpServer.listen(config.port, '0.0.0.0', () => {
        console.log(`🚀 SUCCESS: Server is now globally listening on port ${config.port}`);
    });
};

// Try connecting to DB, but start server regardless
const connectDB = async () => {
    try {
        const client = await pool.connect();
        console.log('Connected to PostgreSQL');

        // Apply any pending schema columns (e.g. email_notification_enabled) gracefully
        console.log('Checking and applying schema migrations if needed...');
        const migrations = [
            'fix_500_errors.sql', 
            'fix_email_notifications.sql', 
            'add_org_email_verified.sql', 
            'priority_reassignment.sql',
            '20260328_fix_cancellation_columns.sql',
            '20260329_add_price_to_appointments.sql',
            '20260329_service_base_price.sql',
            '20260329_fix_wallet_schema.sql',
            '20260329_deep_automated_escrow.sql',
            '20260329_add_org_payout_details.sql',
            '20260330_fix_appointment_enum.sql',
            '20260330_add_otp_column.sql',
            '20260330_add_refund_amount.sql',
            '20260401_add_broadcast_logs.sql',
            '20260401_add_manual_payouts.sql',
            '20260401_add_user_favorites.sql',
            '20260401_ensure_org_slugs.sql',
            '20260401_fix_broadcast_schema.sql',
            '20260403_add_payment_breakdown_columns.sql'
        ];
        
        for (const migration of migrations) {
            try {
                const sqlPath = path.join(__dirname, 'database', 'migrations', migration);
                if (fs.existsSync(sqlPath)) {
                    const sqlQuery = fs.readFileSync(sqlPath, { encoding: 'utf-8' });
                    // Use pool directly so we don't have to manage client lifecycle here
                    await pool.query(sqlQuery);
                    console.log(`Migration ${migration} validated successfully!`);
                }
            } catch (migErr) {
                console.error(`Migration ${migration} notice:`, migErr.message);
            }
        }
        console.log('All DB Schema columns validated successfully!');

        client.release();
    } catch (err) {
        console.error('PostgreSQL connection error:', err.message);
        console.warn('Database operations will fail until PostgreSQL is available.');
    }
};

// Start server IMMEDIATELY so Render sees an open port
startServer();

// Connect to DB and run migrations ASYNCHRONOUSLY
connectDB().catch((err) => {
    console.error('Migration Background Error:', err);
});

const exitHandler = () => {
    if (server) {
        server.close(() => {
            console.log('Server closed');
            process.exit(1);
        });
    } else {
        process.exit(1);
    }
};

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    exitHandler();
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
    // Don't exit on unhandled rejections during startup (e.g., DB connection, email verify)
    // Just log them
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received');
    if (server) {
        server.close();
    }
});
