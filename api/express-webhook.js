const { Telegraf } = require('telegraf');
const express = require('express');
const logger = require('../logger');
const db = require('../db');

const app = express();
app.use(express.json());

// Initialize bot with token
const bot = new Telegraf(process.env.BOT_TOKEN || '7274941037:AAHIWiU5yvfIzo7eJWPu9S5CeJIid6ATEyM');

// State management
const userStates = new Map();
const activeSchedules = new Map();

// Constants
const STATES = {
    AWAITING_TIME: 'awaiting_time',
    AWAITING_CITY: 'awaiting_city',
    AWAITING_DATE: 'awaiting_date',
    AWAITING_GT_INPUT: 'gt',
    AWAITING_DGT_INPUT: 'dgt',
    AWAITING_CGT_INPUT: 'cgt',
    UPDATE_ALL: 'update_all',
    AWAITING_SUBSCRIBE_TYPE: 'subscribe_type'
};

// Register command handlers
bot.command('start', async (ctx) => {
    const userId = ctx.message.from.id;
    userStates.set(userId, STATES.AWAITING_TIME);
    
    const welcomeMessage = `🙏 *Welcome to Panchang Bot!* 🙏

Let's set up your daily updates:
1️⃣ First, enter your preferred time (24-hour format, e.g., 08:00)
2️⃣ Then your city
3️⃣ Finally, the start date

You can also use:
/gt - Get good time intervals
/dgt - Get Drik Panchang timings
/cgt - Get custom good times

Use /help to see all commands.`;
    
    await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
});

bot.command('help', async (ctx) => {
    const helpMessage = `✨ *Panchang Bot Commands* ✨
━━━━━━━━━━━━━━━━━━━━━━━━━
🔸 *Daily Updates*
/start - Set up preferences
/subscribe - Enable daily updates
/stop - Disable updates

🔸 *Manage Preferences*
/change_time - Update time
/change_city - Change city
/change_date - Modify start date
/update_all - Update all settings
/status - View current settings

🔸 *Panchang Commands*
/gt - Get good times
/dgt - Get Drik times
/cgt - Get custom times
/cancel - Cancel current command

📝 *Format Examples:*
• Time: 08:00
• City: Vijayawada
• Date: 2024-01-25
━━━━━━━━━━━━━━━━━━━━━━━━━`;

    await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
});

// Import handlers from bot.js
const { 
    handleGTCommand, 
    handleDGTCommand, 
    handleCGTCommand,
    handleTextMessage,
    saveUserPreferences,
    scheduleUserNotifications,
    initializeSchedules
} = require('../bot');

// Register command handlers
bot.command('gt', async (ctx) => {
    const userId = ctx.message.from.id;
    userStates.delete(userId);
    userStates.set(userId, STATES.AWAITING_GT_INPUT);
    await ctx.reply('Please enter the city and date in the format: City, YYYY-MM-DD');
});

bot.command('dgt', async (ctx) => {
    const userId = ctx.message.from.id;
    userStates.delete(userId);
    userStates.set(userId, STATES.AWAITING_DGT_INPUT);
    await ctx.reply('Please enter the city and date in the format: City, YYYY-MM-DD');
});

bot.command('cgt', async (ctx) => {
    const userId = ctx.message.from.id;
    userStates.delete(userId);
    userStates.set(userId, STATES.AWAITING_CGT_INPUT);
    await ctx.reply('Please enter the city and date in the format: City, YYYY-MM-DD');
});

bot.command('subscribe', async (ctx) => {
    const userId = ctx.message.from.id;
    userStates.delete(userId);
    userStates.set(userId, STATES.AWAITING_TIME);
    const message = `Please enter the time you want to receive daily updates (24-hour format).

Format: HH:mm (e.g., 08:00)`;
    await ctx.reply(message);
});

bot.command('cancel', async (ctx) => {
    const userId = ctx.message.from.id;
    if (userStates.has(userId)) {
        userStates.delete(userId);
        await ctx.reply('✅ Current operation cancelled. What would you like to do next?');
    } else {
        await ctx.reply('No active operation to cancel.');
    }
});

// Register all preference commands
Object.entries(botLogic.preferenceCommands).forEach(([command, config]) => {
    bot.command(command, async (ctx) => {
        const userId = ctx.message.from.id;
        userStates.set(userId, config.state);
        await ctx.reply(config.prompt);
    });
});

// Handle text messages
bot.on('text', async (ctx) => {
    try {
        const userId = ctx.message.from.id;
        const state = userStates.get(userId);
        const input = ctx.message.text;

        if (!state || input.startsWith('/')) return;

        await handleTextMessage(ctx, state, input, userStates);
    } catch (error) {
        logger.error('TEXT_HANDLER_ERROR', error.message);
        await ctx.reply('⚠️ An error occurred. Please try again or use /cancel');
    }
});

// Error handling
bot.catch((err, ctx) => {
    logger.error('Bot error:', err);
    ctx.reply('⚠️ An error occurred. Please try again later.');
});

// Webhook handler
app.all('*', async (req, res) => {
    try {
        if (req.method === 'POST') {
            logger.info('Received webhook update');
            await bot.handleUpdate(req.body);
            return res.status(200).json({ ok: true });
        }
        
        // Health check for GET requests
        if (req.method === 'GET') {
            return res.status(200).json({ 
                status: 'OK',
                timestamp: new Date().toISOString(),
                environment: process.env.NODE_ENV
            });
        }

        res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        logger.error('Webhook error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Initialize schedules in development mode
if (process.env.NODE_ENV === 'development') {
    (async () => {
        try {
            await bot.launch();
            await initializeSchedules();
            logger.info('Bot is running in development mode...');
        } catch (error) {
            logger.error('Error launching bot:', error);
        }
    })();
} else {
    logger.info('Bot is running in webhook mode...');
}

// Cleanup handlers
process.once('SIGINT', () => {
    for (const [userId, job] of activeSchedules) {
        job.cancel();
    }
    activeSchedules.clear();
    bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
    for (const [userId, job] of activeSchedules) {
        job.cancel();
    }
    activeSchedules.clear();
    bot.stop('SIGTERM');
});

module.exports = app;
module.exports.bot = bot;