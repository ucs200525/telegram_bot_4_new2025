const { Telegraf } = require('telegraf');
const express = require('express');
const logger = require('pino')();

const app = express();
app.use(express.json());

// Initialize bot with token
const bot = new Telegraf(process.env.BOT_TOKEN || '7274941037:AAHIWiU5yvfIzo7eJWPu9S5CeJIid6ATEyM');

// Import bot logic after bot initialization
const botLogic = require('../bot.js');

// Initialize bot logic with our bot instance
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
    botLogic.userStates.set(userId, STATES.AWAITING_TIME);
    const welcomeMessage = `🙏 *Welcome to Panchang Bot!* 🙏

Let's set up your daily updates:
1️⃣ First, enter your preferred time (24-hour format, e.g., 08:00)
2️⃣ Then your city
3️⃣ Finally, the start date

You can also use:
\/gt - Get good time intervals
\/dgt - Get Drik Panchang timings
\/cgt - Get custom good times

Use \/help to see all commands.`;
    await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
});

// Register the preference commands
const preferenceCommands = {
    'change_time': {
        state: STATES.AWAITING_TIME,
        prompt: 'Please enter your notification time (24-hour format, e.g., 08:00):'
    },
    'change_city': {
        state: STATES.AWAITING_CITY,
        prompt: 'Please enter your city name:'
    },
    'change_date': {
        state: STATES.AWAITING_DATE,
        prompt: 'Please enter start date (YYYY-MM-DD):'
    }
};

Object.entries(preferenceCommands).forEach(([command, config]) => {
    bot.command(command, async (ctx) => {
        const userId = ctx.message.from.id;
        botLogic.userStates.set(userId, config.state);
        await ctx.reply(config.prompt);
    });
});

// Register main feature commands
bot.command('gt', async (ctx) => {
    const userId = ctx.message.from.id;
    botLogic.userStates.set(userId, STATES.AWAITING_GT_INPUT);
    await ctx.reply('Please enter the city and date in the format: City, YYYY-MM-DD');
});

bot.command('dgt', async (ctx) => {
    const userId = ctx.message.from.id;
    botLogic.userStates.set(userId, STATES.AWAITING_DGT_INPUT);
    await ctx.reply('Please enter the city and date in the format: City, YYYY-MM-DD');
});

bot.command('cgt', async (ctx) => {
    const userId = ctx.message.from.id;
    botLogic.userStates.set(userId, STATES.AWAITING_CGT_INPUT);
    await ctx.reply('Please enter the city and date in the format: City, YYYY-MM-DD');
});

// Register utility commands
bot.command('help', ctx => botLogic.handleHelpCommand(ctx));
bot.command('status', ctx => botLogic.handleStatusCommand(ctx));
bot.command('subscribe', ctx => botLogic.handleSubscribeCommand(ctx));
bot.command('stop', ctx => botLogic.handleStopCommand(ctx));
bot.command('update_all', ctx => botLogic.handleUpdateAllCommand(ctx));
bot.command('cancel', ctx => botLogic.handleCancelCommand(ctx));

// Handle text messages
bot.on('text', ctx => botLogic.handleTextMessage(ctx));

// Webhook handler
app.post('/webhook', async (req, res) => {
    try {
        logger.info('WEBHOOK_UPDATE', 'Received webhook update');
        await bot.handleUpdate(req.body);
        return res.status(200).json({ ok: true });
    } catch (error) {
        logger.error('WEBHOOK_ERROR', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check endpoint
app.get('/', (req, res) => {
    res.status(200).json({ 
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        version: '1.0.0'
    });
});

// Error handling
bot.catch((err, ctx) => {
    logger.error('BOT_ERROR', err);
    ctx.reply('⚠️ An error occurred. Please try again later.');
});

// Initialize bot logic after setting up all handlers
botLogic.init(bot);

// Export both app and bot for testing
module.exports = app;
module.exports.bot = bot;
