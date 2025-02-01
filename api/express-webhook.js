const { Telegraf } = require('telegraf');
const express = require('express');
const logger = require('pino')();

// Initialize express and middleware
const app = express();
app.use(express.json());

// Initialize bot with token
const bot = new Telegraf(process.env.BOT_TOKEN || '7274941037:AAHIWiU5yvfIzo7eJWPu9S5CeJIid6ATEyM');

// Import all handlers and commands from bot.js
const { 
    userStates,
    handleGTCommand, 
    handleDGTCommand,
    isValidDate,
    formatDate 
} = require('../bot');

// Register all bot commands
bot.command('start', async (ctx) => {
    await ctx.reply('🙏 *Welcome to Panchang Bot!*\nUse /help to see available commands.', { parse_mode: 'Markdown' });
});

bot.command('help', async (ctx) => {
    const helpMessage = `✨ *Commands*\n/gt - Get good times\n/dgt - Get Drik timings\n/cancel - Cancel current command`;
    await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
});

bot.command('gt', async (ctx) => {
    userStates.set(ctx.message.from.id, 'gt');
    await ctx.reply('Please enter the city and date in the format: City, YYYY-MM-DD');
});

bot.command('dgt', async (ctx) => {
    userStates.set(ctx.message.from.id, 'dgt');
    await ctx.reply('Please enter the city and date in the format: City, YYYY-MM-DD');
});

bot.command('cancel', async (ctx) => {
    const userId = ctx.message.from.id;
    if (userStates.has(userId)) {
        userStates.delete(userId);
        await ctx.reply('✅ Command cancelled. You can start a new command with /gt or /dgt');
    } else {
        await ctx.reply('No active command to cancel. Use /help to see available commands.');
    }
});

// Register message handler for processing city and date inputs
bot.hears(/.*/, async (messageCtx) => {
    const userId = messageCtx.message.from.id;
    const activeCommand = userStates.get(userId);
    const messageText = messageCtx.message.text;

    // Ignore commands
    if (messageText.startsWith('/')) return;

    // Only process if there's an active command
    if (!activeCommand) return;

    try {
        const [city, date] = messageText.split(',').map(str => str.trim());

        if (!city || !date) {
            return messageCtx.reply('Invalid format. Please use: City, YYYY-MM-DD');
        }

        switch (activeCommand) {
            case 'gt':
                await handleGTCommand(messageCtx, city, date);
                break;
            case 'dgt':
                await handleDGTCommand(messageCtx, city, date);
                break;
        }

        userStates.delete(userId);
    } catch (error) {
        logger.error('Command processing error:', error);
        messageCtx.reply('An error occurred. Please try again or use /cancel.');
    }
});

// Webhook endpoint
app.post('/api/webhook', async (req, res) => {
    try {
        await bot.handleUpdate(req.body);
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
module.exports.bot = bot;
