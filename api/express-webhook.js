const { Telegraf } = require('telegraf');
const express = require('express');
const logger = require('pino')();
const botLogic = require('../bot.js');

const app = express();
app.use(express.json());

// Initialize bot with token
const bot = new Telegraf(process.env.BOT_TOKEN || '7274941037:AAHIWiU5yvfIzo7eJWPu9S5CeJIid6ATEyM');

// Share the bot instance with the bot logic
botLogic.init(bot);

// Register all command handlers
bot.command('start', async (ctx) => {
    const userId = ctx.message.from.id;
    botLogic.userStates.set(userId, botLogic.STATES.AWAITING_TIME);
    const welcomeMessage = `🙏 *Welcome to Panchang Bot!* 🙏\n\nLet's set up your daily updates...`;
    await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
});

// Register preference commands
const preferenceCommands = {
    'change_time': botLogic.STATES.AWAITING_TIME,
    'change_city': botLogic.STATES.AWAITING_CITY,
    'change_date': botLogic.STATES.AWAITING_DATE
};

Object.entries(preferenceCommands).forEach(([command, state]) => {
    bot.command(command, ctx => botLogic.handlePreferenceCommand(ctx, state));
});

// Register main feature commands
bot.command('gt', ctx => botLogic.handleGtCommand(ctx));
bot.command('dgt', ctx => botLogic.handleDgtCommand(ctx));
bot.command('cgt', ctx => botLogic.handleCgtCommand(ctx));

// Register subscription commands
bot.command('subscribe', ctx => botLogic.handleSubscribeCommand(ctx));
bot.command('stop', ctx => botLogic.handleStopCommand(ctx));
bot.command('status', ctx => botLogic.handleStatusCommand(ctx));

// Register utility commands
bot.command('help', ctx => botLogic.handleHelpCommand(ctx));
bot.command('cancel', ctx => botLogic.handleCancelCommand(ctx));
bot.command('update_all', ctx => botLogic.handleUpdateAllCommand(ctx));

// Handle text messages for all states
bot.on('text', ctx => botLogic.handleTextMessage(ctx));

// Default route for webhook
app.all('*', async (req, res) => {
    try {
        if (req.method === 'POST') {
            logger.info('WEBHOOK_UPDATE', 'Received webhook update');
            await bot.handleUpdate(req.body);
            return res.status(200).json({ ok: true });
        }
        
        if (req.method === 'GET') {
            return res.status(200).json({ 
                status: 'OK',
                timestamp: new Date().toISOString(),
                environment: process.env.NODE_ENV,
                version: '1.0.0'
            });
        }

        res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        logger.error('WEBHOOK_ERROR', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add error handling
bot.catch((err, ctx) => {
    logger.error('BOT_ERROR', err);
    ctx.reply('⚠️ An error occurred. Please try again later.');
});

// Export the Express app and bot instance
module.exports = app;
module.exports.bot = bot;
