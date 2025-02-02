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

// Default route for webhook
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

// Export the Express app
module.exports = app;
module.exports.bot = bot;
