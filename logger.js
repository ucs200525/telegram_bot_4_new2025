const pino = require('pino');

// Create logger instance with custom formatting
const logger = pino({
    level: 'info',
    formatters: {
        level: (label) => ({ level: label.toUpperCase() }),
        bindings: () => ({})  // Remove pid and hostname
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`
    // You may add transports here if needed
});

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
