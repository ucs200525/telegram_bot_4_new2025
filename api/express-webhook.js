const { Telegraf } = require('telegraf');
const express = require('express');
const logger = require('../logger');
const botLogic = require('../bot');

const app = express();
app.use(express.json());

// Initialize bot with token
const bot = new Telegraf(process.env.BOT_TOKEN || '7274941037:AAHIWiU5yvfIzo7eJWPu9S5CeJIid6ATEyM');

// Initialize the bot with all handlers
botLogic.init(bot);

const PORT = process.env.PORT || 3000;

// Webhook route
app.post('/webhook', async (req, res) => {
    try {
        logger.info('Received webhook update');
        await bot.handleUpdate(req.body);
        res.status(200).json({ ok: true });
    } catch (error) {
        logger.error('Webhook error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check route
app.get('/', (req, res) => {
    res.status(200).json({ 
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV
    });
});

// Handle other methods
app.all('*', (req, res) => {
    res.status(405).json({ error: 'Method not allowed' });
});

// Initialize schedules if in development mode
if (process.env.NODE_ENV === 'development') {
    (async () => {
        try {
            await bot.launch();
            await botLogic.initializeSchedules();
            logger.info(`Bot is running in development mode on port ${PORT}...`);
            app.listen(PORT);
        } catch (error) {
            logger.error('Error launching bot:', error);
            process.exit(1);
        }
    })();
} else {
    // Webhook mode
    app.listen(PORT, () => {
        logger.info(`Bot is running in webhook mode on port ${PORT}...`);
    });
}

// Cleanup handlers
process.once('SIGINT', () => {
    botLogic.cleanup();
    bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
    botLogic.cleanup();
    bot.stop('SIGTERM');
});

module.exports = app;
module.exports.bot = bot;