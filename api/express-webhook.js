const { Telegraf } = require('telegraf');
const express = require('express');
const logger = require('pino')();

// Initialize express
const app = express();
app.use(express.json());

// Initialize bot with token
const bot = new Telegraf(process.env.BOT_TOKEN || '7274941037:AAHIWiU5yvfIzo7eJWPu9S5CeJIid6ATEyM');

// Import bot commands and handlers
const { 
    userStates,
    handleGTCommand, 
    handleDGTCommand 
} = require('../bot');

// Set up basic bot commands
bot.command('start', ctx => ctx.reply('🙏 Welcome to Panchang Bot!\nUse /help to see available commands.'));
bot.command('help', ctx => ctx.reply('✨ Commands:\n/gt - Get good times\n/dgt - Get Drik timings'));

// Webhook endpoint
app.post('/api/webhook', (req, res) => {
    try {
        bot.handleUpdate(req.body);
        res.sendStatus(200);
    } catch (error) {
        logger.error('Webhook error:', error);
        res.status(500).json({ error: 'Failed to process update' });
    }
});

// Set webhook URL (use environment variable in production)
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://telegram-bot-4-new2025.vercel.app/api/webhook';

// Set webhook with error handling
const setupWebhook = async () => {
    try {
        await bot.telegram.setWebhook(WEBHOOK_URL);
        logger.info('Webhook set successfully to:', WEBHOOK_URL);
    } catch (error) {
        logger.error('Error setting webhook:', error);
        throw error;
    }
};

// Initialize bot in development or production mode
if (process.env.NODE_ENV === 'development') {
    bot.launch().then(() => {
        logger.info('Bot running in development mode');
    }).catch(error => {
        logger.error('Failed to start bot:', error);
    });
} else {
    setupWebhook().catch(error => {
        logger.error('Failed to set webhook:', error);
    });
}

// Error handling
bot.catch((err, ctx) => {
    logger.error('Bot error:', err);
    ctx.reply('An error occurred. Please try again.');
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

module.exports = app;
