const { Telegraf } = require('telegraf');
const express = require('express');
const logger = require('pino')();
const botLogic = require('../bot.js');  // Import the entire bot logic file

const app = express();
app.use(express.json());

// Initialize bot with token
const bot = new Telegraf(process.env.BOT_TOKEN || '7274941037:AAHIWiU5yvfIzo7eJWPu9S5CeJIid6ATEyM');

// Share the bot instance with the bot logic
botLogic.init(bot);

// Register commands with correct function names
bot.command('start', ctx => ctx.reply('🙏 Welcome! Use /help to see commands', { parse_mode: 'Markdown' }));
bot.command('help', ctx => ctx.reply('✨ Commands:\n/gt - Get good times\n/dgt - Get Drik timings', { parse_mode: 'Markdown' }));
bot.command('gt', botLogic.handleGtCommand);
bot.command('dgt', botLogic.handleDgtCommand);
bot.command('cancel', botLogic.handleCancelCommand);

// Handle text messages
bot.on('text', botLogic.handleTextMessage);

// Webhook handler
app.post('/webhook', async (req, res) => {
    try {
        logger.info('Received webhook update');
        await bot.handleUpdate(req.body);
        res.sendStatus(200);
    } catch (error) {
        logger.error('Webhook error:', error);
        res.status(500).send();
    }
});

// Health check
app.get('/health', (_, res) => res.send('OK'));

module.exports = app;
module.exports.bot = bot;
