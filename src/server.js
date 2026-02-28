const app = require('./app');
const config = require('./config/config');
const { pool } = require('./config/db');

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
        client.release();
    } catch (err) {
        console.error('PostgreSQL connection error:', err.message);
        console.warn('Server will start but database operations will fail until PostgreSQL is available.');
    }
};

connectDB().then(startServer).catch((err) => {
    console.error('Fatal startup error:', err);
    // Still try to start the server
    startServer();
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
