const { Telegraf } = require('telegraf');
const logger = require('pino')();

// Initialize bot with your token
const bot = new Telegraf(process.env.BOT_TOKEN || '7274941037:AAHIWiU5yvfIzo7eJWPu9S5CeJIid6ATEyM');

// Import bot logic
const { 
    userStates,
    handleGTCommand, 
    handleDGTCommand 
} = require('../bot');

// Set up bot commands
bot.command('start', async (ctx) => {
    await ctx.reply('🙏 Welcome to Panchang Bot!\nUse /help to see available commands.', {
        parse_mode: 'Markdown'
    });
});

bot.command('help', async (ctx) => {
    await ctx.reply(`✨ *Commands*\n/gt - Get good times\n/dgt - Get Drik timings`, {
        parse_mode: 'Markdown'
    });
});

// Webhook handler
const webhookHandler = async (request, response) => {
    try {
        // Verify request method
        if (request.method !== 'POST') {
            response.status(200).json({
                body: 'OK',
                query: request.query,
                cookies: request.cookies,
            });
            return;
        }

        // Process update
        try {
            await bot.handleUpdate(request.body);
        } catch (err) {
            logger.error('Error handling update:', err);
            // Don't throw here, just log
        }

        // Always return 200 to Telegram
        response.status(200).json({ ok: true });
    } catch (error) {
        logger.error('Webhook error:', error);
        response.status(500).json({ 
            ok: false,
            error: error.message 
        });
    }
};

// Error handling
bot.catch((err, ctx) => {
    logger.error('Bot error:', err);
    ctx.reply('Sorry, something went wrong. Please try again.');
});

// Development mode support
if (process.env.NODE_ENV === 'development') {
    bot.launch().then(() => {
        logger.info('Bot running in development mode');
    }).catch(err => {
        logger.error('Failed to start bot:', err);
    });
}

// Export the handler
module.exports = webhookHandler;

// Export bot for testing
module.exports.bot = bot;
