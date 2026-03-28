const app = require('./app');
const config = require('./config/config');
const { pool } = require('./config/db');
const fs = require('fs');
const path = require('path');

const http = require('http');
let socket;
let reminderCron;

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

    server = httpServer.listen(config.port, () => {
        console.log(`Server running on port ${config.port}`);
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
            '20260328_fix_cancellation_columns.sql'
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
