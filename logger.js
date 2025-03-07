const pino = require('pino');
const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

// Common transport options
const transportOptions = {
    translateTime: 'yyyy-mm-dd HH:MM:ss',
    ignore: 'pid,hostname',
    messageFormat: '{level} {action}: {message}',
    singleLine: true
};

// Configure file transport
const fileTransport = pino.destination({
    dest: path.join(logsDir, 'app.log'),
    sync: false
});

// Configure console transport
const consoleTransport = pino.transport({
    target: 'pino-pretty',
    options: {
        ...transportOptions,
        colorize: true
    }
});

// Create logger instance with custom formatting
const logger = pino({
    level: 'info',
    formatters: {
        level: (label) => ({ level: label.toUpperCase() }),
        bindings: () => ({})  // Remove pid and hostname
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`
}, pino.multistream([
    { stream: fileTransport },
    { stream: consoleTransport }
]));

// Helper function to format messages
const formatMessage = (action, msg, data = {}) => ({
    action,
    message: msg,
    ...data
});

module.exports = {
    info: (action, msg, data) => {
        logger.info(formatMessage(action, msg, data));
    },
    warn: (action, msg, data) => {
        logger.warn(formatMessage(action, msg, data));
    },
    error: (action, msg, data) => {
        logger.error(formatMessage(action, msg, data));
    },
    debug: (action, msg, data) => {
        logger.debug(formatMessage(action, msg, data));
    }
};
