const pino = require('pino');

// Configure logger with both file and console output
const logger = pino({
    level: 'debug',
    timestamp: pino.stdTimeFunctions.isoTime,
}, pino.multistream([
    { stream: pino.destination('./logs/test.log') },
    { stream: process.stdout }
]));

// Test different log levels
logger.debug('🔍 Debug level test');

// Test info logs with structured data
logger.info({
    action: 'SERVER_START',
    environment: 'production',
    version: '1.0.0',
    timestamp: new Date().toISOString()
}, '🚀 Server initialized successfully');

// Test error logs with detailed context
logger.error({
    action: 'API_CALL',
    endpoint: '/api/data',
    statusCode: 500,
    errorId: 'ERR001',
    stack: new Error().stack
}, '🔥 Failed to fetch API data');

// Test warning logs with context
logger.warn({
    action: 'RATE_LIMIT',
    client: '127.0.0.1',
    limit: '100/hour',
    current: '95',
    timestamp: new Date().toISOString()
}, '⚠️ Approaching rate limit threshold');

// Test child loggers
const childLogger = logger.child({ component: 'UserService' });
childLogger.info({
    action: 'USER_LOGIN',
    userId: 'user123',
    timestamp: new Date().toISOString()
}, '👤 User logged in successfully');

// Test error with try-catch
try {
    throw new Error('Test error');
} catch (error) {
    logger.error({
        action: 'ERROR_HANDLER',
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
    }, '💥 Caught test error');
}

console.log('✅ Logging tests completed - Check logs/test.log for output');