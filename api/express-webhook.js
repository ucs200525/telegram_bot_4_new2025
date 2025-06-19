const { Telegraf } = require('telegraf');
const express = require('express');
const logger = require('../logger');
const botLogic = require('../bot');
const path = require('path');

const app = express();
app.use(express.json());

// Add static file middleware
app.use(express.static(path.join(__dirname, '../public')));

// Favicon handler
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/favicon.ico'));
});

app.get('/favicon.png', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/favicon.png'));
});

// Initialize bot with token
const bot = new Telegraf(process.env.BOT_TOKEN || '7274941037:AAHIWiU5yvfIzo7eJWPu9S5CeJIid6ATEyM');

// Initialize the bot with all handlers
botLogic.init(bot);

const PORT = process.env.PORT || 3000;
const WEBHOOK_PATH = '/webhook';
const DOMAIN = process.env.DOMAIN || `https://telegram-bot-4-new2025.vercel.app/`;

// Update webhook setup with secret token
async function setupWebhook() {
    try {
        const webhookUrl = `${DOMAIN}${WEBHOOK_PATH}`;
        const secretPath = Math.random().toString(36).substring(7);
        
        await bot.telegram.setWebhook(webhookUrl, {
            allowed_updates: ['message', 'callback_query'],
            drop_pending_updates: true
        });
        
        logger.info('WEBHOOK_SETUP', `Webhook set to ${webhookUrl}`);
        return secretPath;
    } catch (error) {
        logger.error('WEBHOOK_SETUP_ERROR', error.message);
        throw error;
    }
}

// Update webhook route to parse updates
app.post(WEBHOOK_PATH, async (req, res) => {
    try {
        if (!req.body) {
            return res.status(400).json({ error: 'No body provided' });
        }

        const update = req.body;
        logger.info('WEBHOOK_UPDATE', `Received update type: ${update.message ? 'message' : 'other'}`);
        
        if (update.message?.text?.startsWith('/')) {
            logger.info('COMMAND_RECEIVED', `Command: ${update.message.text}`);
        }

        await bot.handleUpdate(update);
        res.status(200).json({ ok: true });
    } catch (error) {
        logger.error('WEBHOOK_ERROR', error.message);
        res.status(500).json({ 
            ok: false,
            error: 'Internal server error',
            message: error.message 
        });
    }
});

// Root route - add POST handler
app.post('/', (req, res) => {
    res.status(308).json({ 
        ok: false,
        error: 'Permanent Redirect',
        location: WEBHOOK_PATH
    });
});

// Health check route
app.get('/', (req, res) => {
    res.status(200).json({ 
        ok: true,
        status: 'active',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'production'
    });
});

// Update the catch-all route to be more specific
app.use((req, res) => {
    logger.warn('INVALID_ROUTE', `${req.method} ${req.path}`);
    res.status(405).json({ 
        ok: false,
        error: 'Method not allowed',
        allowedMethods: ['GET', 'POST'],
        path: req.path
    });
});

// Update initialization
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
    (async () => {
        try {
            await setupWebhook();
            app.listen(PORT, () => {
                logger.info(`Bot is running in webhook mode on port ${PORT}...`);
            });
        } catch (error) {
            logger.error('Error setting up webhook:', error);
            process.exit(1);
        }
    })();
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