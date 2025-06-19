const { Telegraf } = require('telegraf');
const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const schedule = require('node-schedule');

// Add initial log to verify logging is working
logger.info('BOT_INIT', 'Bot logging initialized');

// State constants
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

// Add typeNames constant
const typeNames = {
    gt: 'Good Times Table',
    dgt: 'Drik Panchang Table',
    cgt: 'Combined Table'
};

// Helper functions
const isValidTime = (time) => {
    return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time);
};

const isValidDate = (dateString) => {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date) && /^\d{4}-\d{2}-\d{2}$/.test(dateString);
};

const getTimezoneForCity = async (city) => {
    try {
        const geoNamesUrl = `http://api.geonames.org/searchJSON?q=${city}&maxRows=1&username=ucs05`;
        const response = await axios.get(geoNamesUrl);
        
        if (!response.data.geonames?.[0]) {
            throw new Error('City not found');
        }

        const { lat, lng } = response.data.geonames[0];
        const timezoneUrl = `http://api.geonames.org/timezoneJSON?lat=${lat}&lng=${lng}&username=ucs05`;
        const tzResponse = await axios.get(timezoneUrl);
        
        return tzResponse.data.timezoneId;
    } catch (error) {
        logger.error('TIMEZONE_ERROR', `Error getting timezone for ${city}: ${error.message}`);
        throw error;
    }
};

// Handler functions
async function handleGTCommand(messageCtx, city, date) {
    let loadingMessage = null;
    try {
        const sendMessage = async (text, options = {}) => {
            if (messageCtx.reply) {
                return await messageCtx.reply(text, options);
            } else if (messageCtx.telegram) {
                return await messageCtx.telegram.sendMessage(messageCtx.chat.id, text, options);
            }
        };

        const sendPhoto = async (photo, options = {}) => {
            if (messageCtx.replyWithPhoto) {
                return await messageCtx.replyWithPhoto(photo, options);
            } else if (messageCtx.telegram) {
                return await messageCtx.telegram.sendPhoto(messageCtx.chat.id, photo, options);
            }
        };

        const deleteMessage = async (messageId) => {
            if (messageCtx.telegram) {
                try {
                    await messageCtx.telegram.deleteMessage(messageCtx.chat.id, messageId);
                } catch (e) {
                    logger.warn('DELETE_MSG_ERROR', 'Could not delete message');
                }
            }
        };

        loadingMessage = await sendMessage('⏳ Generating time table...');
        logger.info('GT_PROCESS', `Starting GT process for ${city} on ${date}`);

        const requestData = {
            city: city,
            date: date,
            showNonBlue: false,
            is12HourFormat: true
        };

        const imageResponse = await axios({
            method: 'post',
            url: `https://panchang-aik9.vercel.app/api/getBharagvTable-image`,
            data: requestData,
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'image/*'
            },
            httpsAgent: new (require('https').Agent)({  
                rejectUnauthorized: false
            })
        });

        logger.info('GT_IMAGE', `Image received for ${city}`);

        if (loadingMessage) {
            await deleteMessage(loadingMessage.message_id);
        }

        await sendPhoto(
            { source: Buffer.from(imageResponse.data) },
            { 
                caption: `🗓️ Good Times Table\n📍 ${city}\n📅 ${date}\n\n💫 Choose your time wisely!`,
                parse_mode: 'Markdown'
            }
        );

    } catch (error) {
        logger.error('GT_ERROR', `Error in GT command: ${error.message}`);
        
        if (loadingMessage) {
            await deleteMessage(loadingMessage.message_id);
        }
        
        const errorMessage = error.code === 'EPROTO' || error.code === 'ETIMEDOUT'
            ? '⚠️ Connection error. Please try again.'
            : error.response?.status === 400
            ? '⚠️ Invalid city or date format.'
            : error.code === 'ECONNABORTED'
            ? '⚠️ Request timed out. Please try again.'
            : '⚠️ Error generating time table. Please try again later.';

        await sendMessage(errorMessage);
        throw error;
    }
}

async function handleDGTCommand(messageCtx, city, date) {
    let loadingMessage = null;
    try {
        const sendMessage = async (text, options = {}) => {
            if (messageCtx.reply) {
                return await messageCtx.reply(text, options);
            } else if (messageCtx.telegram) {
                return await messageCtx.telegram.sendMessage(messageCtx.chat.id, text, options);
            }
        };

        const sendPhoto = async (photo, options = {}) => {
            if (messageCtx.replyWithPhoto) {
                return await messageCtx.replyWithPhoto(photo, options);
            } else if (messageCtx.telegram) {
                return await messageCtx.telegram.sendPhoto(messageCtx.chat.id, photo, options);
            }
        };

        const deleteMessage = async (messageId) => {
            if (messageCtx.telegram) {
                try {
                    await messageCtx.telegram.deleteMessage(messageCtx.chat.id, messageId);
                } catch (e) {
                    logger.warn('DELETE_MSG_ERROR', 'Could not delete message');
                }
            }
        };

        loadingMessage = await sendMessage('⏳ Generating Drik Panchang table...');
        const [year, month, day] = date.split('-');
        const formattedDate = `${day}/${month}/${year}`;
        logger.info('DGT_PROCESS', `Starting DGT process for ${city} on ${formattedDate}`);

        const requestData = {
            city: city,
            date: formattedDate,
            goodTimingsOnly: false
        };

        const imageResponse = await axios({
            method: 'post',
            url: 'https://panchang-aik9.vercel.app/api/getDrikTable-image',
            data: requestData,
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'image/*'
            }
        });

        logger.info('DGT_IMAGE', `Image received for ${city}`);

        if (loadingMessage) {
            await deleteMessage(loadingMessage.message_id);
        }

        await sendPhoto(
            { source: Buffer.from(imageResponse.data) },
            { 
                caption: `✨ Drik Panchang Timings\n📍 ${city}\n📅 ${date}\n\n💫 Plan your activities accordingly!`,
                parse_mode: 'Markdown'
            }
        );

    } catch (error) {
        logger.error('DGT_ERROR', `Error in DGT command: ${error.message}`);
        
        if (loadingMessage) {
            await deleteMessage(loadingMessage.message_id);
        }
        
        const errorMessage = error.code === 'ECONNREFUSED'
            ? '⚠️ Server connection failed. Please try again later.'
            : error.response?.status === 400
            ? '⚠️ Invalid city or date format.'
            : error.code === 'ECONNABORTED'
            ? '⚠️ Request timed out. Please try again.'
            : '⚠️ Error generating Drik Panchang table. Please try again later.';

        await sendMessage(errorMessage);
        throw error;
    }
}

async function handleCGTCommand(messageCtx, city, date) {
    let loadingMessage = null;
    try {
        const sendMessage = async (text, options = {}) => {
            if (messageCtx.reply) {
                return await messageCtx.reply(text, options);
            } else if (messageCtx.telegram) {
                return await messageCtx.telegram.sendMessage(messageCtx.chat.id, text, options);
            }
        };

        const sendPhoto = async (photo, options = {}) => {
            if (messageCtx.replyWithPhoto) {
                return await messageCtx.replyWithPhoto(photo, options);
            } else if (messageCtx.telegram) {
                return await messageCtx.telegram.sendPhoto(messageCtx.chat.id, photo, options);
            }
        };

        const deleteMessage = async (messageId) => {
            if (messageCtx.telegram) {
                try {
                    await messageCtx.telegram.deleteMessage(messageCtx.chat.id, messageId);
                } catch (e) {
                    logger.warn('DELETE_MSG_ERROR', 'Could not delete message');
                }
            }
        };

        loadingMessage = await sendMessage('⏳ Generating combined time table...');
        logger.info('CGT_PROCESS', `Starting CGT process for ${city} on ${date}`);
        
        const [year, month, day] = date.split('-');
        const formattedDate = `${day}/${month}/${year}`;
        
        const muhuratResponse = await axios.get(
            `https://panchang-aik9.vercel.app/api/getDrikTable?city=${city}&date=${formattedDate}&goodTimingsOnly=true`
        );
        if (muhuratResponse.status !== 200) throw new Error('Failed to fetch muhurat data');
        const muhuratData = muhuratResponse.data;
        logger.info('CGT_MUHURAT', 'Fetched muhurat data');

        const panchangamResponse = await axios.get(
            `https://panchang-aik9.vercel.app/api/getBharagvTable?city=${city}&date=${date}&showNonBlue=true&is12HourFormat=true`
        );
        if (panchangamResponse.status !== 200) throw new Error('Failed to fetch panchangam data');
        const panchangamData = panchangamResponse.data;
        logger.info('CGT_PANCHANGAM', 'Fetched panchangam data');

        const imageResponse = await axios({
            method: 'post',
            url: 'https://panchang-aik9.vercel.app/api/combine-image',
            data: { 
                muhuratData, 
                panchangamData,
                city, 
                date 
            },
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'image/*'
            }
        });

        logger.info('CGT_IMAGE', `Combined image received for ${city}`);

        if (loadingMessage) {
            await deleteMessage(loadingMessage.message_id);
        }

        await sendPhoto(
            { source: Buffer.from(imageResponse.data) },
            { 
                caption: `🎯 Combined Times Table\n📍 ${city}\n📅 ${date}\n\n💫 Plan your activities wisely!`,
                parse_mode: 'Markdown'
            }
        );

    } catch (error) {
        logger.error('CGT_ERROR', `Error in CGT command: ${error.message}`);
        
        if (loadingMessage) {
            await deleteMessage(loadingMessage.message_id);
        }
        
        const errorMessage = error.response?.status === 400
            ? '⚠️ Invalid data format. Please check city and date.'
            : error.code === 'ECONNREFUSED'
            ? '⚠️ Server connection failed. Please try again later.'
            : '⚠️ Error generating combined table. Please try again later.';

        await sendMessage(errorMessage);
        throw error;
    }
}

async function scheduleUserNotifications(userId, preferences) {
    if (activeSchedules.has(userId)) {
        activeSchedules.get(userId).cancel();
    }

    try {
        const timezone = await getTimezoneForCity(preferences.city);
        const [hours, minutes] = preferences.notificationTime.split(':');

        const rule = new schedule.RecurrenceRule();
        rule.hour = parseInt(hours);
        rule.minute = parseInt(minutes);
        rule.tz = timezone;

        const job = schedule.scheduleJob(rule, async () => {
            try {
                // Handle notifications based on subscription types
                const types = preferences.subscriptionTypes || [];
                for (const type of types) {
                    switch (type) {
                        case 'gt':
                            await handleGTCommand(ctx, preferences.city, preferences.startDate);
                            break;
                        case 'dgt':
                            await handleDGTCommand(ctx, preferences.city, preferences.startDate);
                            break;
                        case 'cgt':
                            await handleCGTCommand(ctx, preferences.city, preferences.startDate);
                            break;
                    }
                }
            } catch (error) {
                logger.error('NOTIFICATION_ERROR', `Error sending notification to user ${userId}: ${error.message}`);
            }
        });

        activeSchedules.set(userId, job);
        logger.info('SCHEDULE_SET', `Set notification schedule for user ${userId} at ${preferences.notificationTime} ${timezone}`);

    } catch (error) {
        logger.error('SCHEDULE_ERROR', `Error setting schedule: ${error.message}`);
        throw error;
    }
}

async function saveUserPreferences(userId, preferences) {
    try {
        await db.savePreferences(userId, preferences);
        
        if (preferences.notificationTime && preferences.isSubscribed) {
            await scheduleUserNotifications(userId, await db.getPreferences(userId));
        }
        
        logger.info('PREFS_SAVED', `Preferences saved for user ${userId}`);
    } catch (error) {
        logger.error('PREFS_SAVE_ERROR', `Error saving preferences: ${error.message}`);
        throw error;
    }
}

async function initializeSchedules() {
    try {
        const subscribers = await db.getAllSubscribed();
        for (const user of subscribers) {
            await scheduleUserNotifications(user.userId, user);
        }
        logger.info('SCHEDULES_INITIALIZED', `Initialized ${subscribers.length} notification schedules`);
    } catch (error) {
        logger.error('SCHEDULE_INIT_ERROR', `Failed to initialize schedules: ${error.message}`);
    }
}

// Initialize bot and state management
let bot = null; // Will be initialized with init()
const userStates = new Map();
const activeSchedules = new Map();

// Initialize bot reference
function init(botInstance) {
    bot = botInstance;
    logger.info('BOT_INIT', 'Bot initialized');
    setupEventHandlers(bot);
}

// Setup all event handlers
function setupEventHandlers(bot) {
    // Command handlers
    bot.command('start', handleStartCommand);
    bot.command('subscribe', handleSubscribeCommand);
    bot.command('stop', handleStopCommand);
    bot.command('status', handleStatusCommand);
    bot.command('help', handleHelpCommand);
    bot.command('gt', handleGtCommand);
    bot.command('dgt', handleDgtCommand);
    bot.command('cgt', handleCgtCommand);
    bot.command('cancel', handleCancelCommand);
    bot.command('update_all', handleUpdateAllCommand);

    // Register preference commands
    Object.entries(preferenceCommands).forEach(([command, config]) => {
        bot.command(command, (ctx) => handlePreferenceCommand(ctx, config));
    });

    // Handle text messages
    bot.hears(/.*/, handleTextMessage);
}

// Command handler functions
async function handleStartCommand(ctx) {
    const userId = ctx.message.from.id;
    userStates.set(userId, STATES.AWAITING_TIME);
    
    const welcomeMessage = `🙏 *Welcome to Panchang Bot!* 🙏\n\nLet's set up your daily updates:\n1️⃣ First, enter your preferred time (24-hour format, e.g., 08:00)\n2️⃣ Then your city\n3️⃣ Finally, the start date\n\nYou can also use:\n/gt - Get good time intervals\n/dgt - Get Drik Panchang timings\n/cgt - Get custom good times\n\nUse /help to see all commands.`;
    
    await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
}

botInstance.command('subscribe', async (ctx) => {
    const userId = ctx.message.from.id;
    userStates.delete(userId);
    userStates.set(userId, STATES.AWAITING_TIME);
    const message = `Please enter the time you want to receive daily updates (24-hour format).

Format: HH:mm (e.g., 08:00)`;
    await ctx.reply(message);

});


const preferenceCommands = {
    'change_time': {
        state: STATES.AWAITING_TIME,
        prompt: 'Please enter your notification time (24-hour format, e.g., 08:00):',
        validate: (input) => isValidTime(input),
        save: (userId, input) => saveUserPreferences(userId, { notificationTime: input })
    },
    'change_city': {
        state: STATES.AWAITING_CITY,
        prompt: 'Please enter your city name:',
        validate: (input) => input.length > 2,
        save: (userId, input) => saveUserPreferences(userId, { city: input })
    },
    'change_date': {
        state: STATES.AWAITING_DATE,
        prompt: 'Please enter start date (YYYY-MM-DD):',
        validate: (input) => isValidDate(input),
        save: (userId, input) => saveUserPreferences(userId, { startDate: input })
    }
};

// Register preference commands
Object.entries(preferenceCommands).forEach(([command, config]) => {
    botInstance.command(command, async (ctx) => {
        const userId = ctx.message.from.id;
        userStates.set(userId, config.state);
        await ctx.reply(config.prompt);
    });
});


botInstance.command('update_all', async (ctx) => {
    const userId = ctx.message.from.id;
    userStates.set(userId, STATES.UPDATE_ALL);
    await ctx.reply('Let\'s update all your preferences.\nFirst, enter your preferred time (24-hour format, e.g., 08:00):');
});


botInstance.command('stop', async (ctx) => {
    const userId = ctx.message.from.id;
    try {
        const prefs = await db.getPreferences(userId);
        
        if (!prefs?.isSubscribed) {
            await ctx.reply('❌ You are not currently subscribed to any updates.');
            return;
        }

        await db.savePreferences(userId, {
            ...prefs,
            isSubscribed: false,
            subscriptionTypes: null,
            notificationTime: null
        });
        
        await ctx.reply('✅ Successfully unsubscribed from daily updates. Your other preferences have been kept.\n\nUse /subscribe to subscribe again.');
    } catch (error) {
        logger.error('STOP_ERROR', `Error in stop command: ${error.message}`);
        await ctx.reply('❌ Error processing your request. Please try again.');
    }
});


// Update the status command handler
botInstance.command('status', async (ctx) => {
    const userId = ctx.message.from.id;
    try {
        const prefs = await db.getPreferences(userId);
        
        if (!prefs) {
            await ctx.reply('No preferences set. Use /subscribe to set up your preferences.');
            return;
        }

        const lastUpdated = prefs.lastUpdated ? 
            new Date(prefs.lastUpdated).toLocaleString() : 'Never';

        const escapeMarkdown = (text) => {
            return text ? text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&') : 'Not set';
        };

        const timezone = await getTimezoneForCity(prefs.city);
        const statusMessage = `*Current Settings*\n\n` +
            `🌆 City: ${escapeMarkdown(prefs.city)}\n` +
            `🌍 Timezone: ${escapeMarkdown(timezone)}\n` +
            `📅 Start Date: ${escapeMarkdown(prefs.startDate)}\n` +
            `⏰ Notification Time: ${escapeMarkdown(prefs.notificationTime)} (${escapeMarkdown(timezone)})\n` +
            `📱 Subscription Status: ${prefs.isSubscribed ? '✅ Active' : '❌ Inactive'}\n`;

        // Add subscription types if subscribed
        let subscriptionTypes = '';
        if (prefs.isSubscribed && prefs.subscriptionTypes && prefs.subscriptionTypes.length > 0) {
            const types = prefs.subscriptionTypes
                .map(type => typeNames[type])
                .join(', ');
            subscriptionTypes = `\n📬 Subscribed Updates: ${escapeMarkdown(types)}`;
        }

        const lastUpdateInfo = `\n🔄 Last Updated: ${escapeMarkdown(lastUpdated)}`;

        const commandsHelp = `\n\n*Available Commands:*\n` +
            `• /subscribe \\- Enable daily updates\n` +
            `• /stop \\- Disable updates\n` +
            `• /change\\_time \\- Update notification time\n` +
            `• /change\\_city \\- Change city\n` +
            `• /change\\_date \\- Modify start date`;

        await ctx.reply(
            statusMessage + subscriptionTypes + lastUpdateInfo + commandsHelp,
            { 
                parse_mode: 'MarkdownV2',
                disable_web_page_preview: true
            }
        );

    } catch (error) {
        logger.error('STATUS_ERROR', `Error in status command: ${error.message}`);
        await ctx.reply('❌ Error retrieving your preferences. Please try again.');
    }
});


// Updated help command
botInstance.command('help', async (ctx) => {
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

// Modify the existing hears handler to handle new states
bot.hears(/.*/, async (ctx) => {
    const userId = ctx.message.from.id;
    const state = userStates.get(userId);
    const input = ctx.message.text;

    // Ignore commands
    if (!state || input.startsWith('/')) return;

    try {
        switch (state) {
            case STATES.AWAITING_TIME:
                if (!isValidTime(input)) {
                    await ctx.reply('⚠️ Invalid time format. Please use HH:mm (e.g., 08:00)');
                    return;
                }
                await saveUserPreferences(userId, { notificationTime: input });
                userStates.set(userId, STATES.AWAITING_CITY);
                await ctx.reply('✅ Notification time saved! Now please enter your city:');
                break;

            case STATES.AWAITING_CITY:
                await saveUserPreferences(userId, { city: input });
                userStates.set(userId, STATES.AWAITING_DATE);
                await ctx.reply('✅ City saved! Now enter start date (YYYY-MM-DD):');
                break;

            case STATES.AWAITING_DATE:
                if (!isValidDate(input)) {
                    await ctx.reply('⚠️ Invalid date format. Please use YYYY-MM-DD');
                    return;
                }
                await saveUserPreferences(userId, { startDate: input });
                userStates.set(userId, STATES.AWAITING_SUBSCRIBE_TYPE);
                const typeMessage = `Please select the type of updates you want to receive.
                
Available options:
1️⃣ GT - Good Times Table
2️⃣ DGT - Drik Panchang Table
3️⃣ CGT - Combined Table
4️⃣ GT+DGT
5️⃣ GT+CGT
6️⃣ ALL

Reply with the number (1-6):`;
                await ctx.reply(typeMessage);
                break;

            case STATES.AWAITING_SUBSCRIBE_TYPE:
                const validOptions = ['1', '2', '3', '4', '5', '6'];
                if (!validOptions.includes(input)) {
                    await ctx.reply('⚠️ Invalid option. Please select a number between 1-6');
                    return;
                }

                const typeMap = {
                    '1': ['gt'],
                    '2': ['dgt'],
                    '3': ['cgt'],
                    '4': ['gt', 'dgt'],
                    '5': ['gt', 'cgt'],
                    '6': ['gt', 'dgt', 'cgt']
                };

                const selectedTypes = typeMap[input];
                
                try {
                    const currentPrefs = await db.getPreferences(userId);
                    
                    await saveUserPreferences(userId, {
                        ...currentPrefs,
                        subscriptionTypes: selectedTypes,
                        isSubscribed: true
                    });

                    const prefs = await db.getPreferences(userId);
                    
                    const subscriptionMessage = `✅ Subscription successful!
                
📍 City: ${prefs.city}
⏰ Daily Updates Time: ${prefs.notificationTime}
📅 Start Date: ${prefs.startDate}
📊 Selected Updates: ${selectedTypes.map(t => typeNames[t]).join(', ')}

You will receive your selected updates daily at ${prefs.notificationTime}.`;
                    
                    await ctx.reply(subscriptionMessage);
                    userStates.delete(userId);
                } catch (error) {
                    logger.error('SUBSCRIPTION_ERROR', error.message);
                    await ctx.reply('❌ Error saving subscription. Please try again.');
                    userStates.delete(userId);
                }
                break;

            // Handle existing GT/DGT commands
            case STATES.AWAITING_GT_INPUT:
                logger.info('GT_INPUT', `Processing GT command for input: ${input}`);
                const [city, date] = input.split(',').map(s => s.trim());
                
                if (!city || !date) {
                    await ctx.reply('⚠️ Invalid format. Please use: City, YYYY-MM-DD');
                    return;
                }
                
                if (!isValidDate(date)) {
                    await ctx.reply('⚠️ Invalid date format. Please use YYYY-MM-DD');
                    return;
                }

                try {
                    await handleGTCommand(ctx, city, date);
                } catch (error) {
                    logger.error('GT_COMMAND_ERROR', `Error in GT command: ${error.message}`);
                    await ctx.reply('⚠️ Error generating time table. Please try again.');
                }
                userStates.delete(userId);
                break;
                
            case STATES.AWAITING_DGT_INPUT:
                logger.info('DGT_INPUT', `Processing DGT command for input: ${input}`);
                const [dgtCity, dgtDate] = input.split(',').map(s => s.trim());
                
                if (!dgtCity || !dgtDate) {
                    await ctx.reply('⚠️ Invalid format. Please use: City, YYYY-MM-DD');
                    return;
                }
                
                if (!isValidDate(dgtDate)) {
                    await ctx.reply('⚠️ Invalid date format. Please use YYYY-MM-DD');
                    return;
                }

                try {
                    await handleDGTCommand(ctx, dgtCity, dgtDate);
                } catch (error) {
                    logger.error('DGT_COMMAND_ERROR', `Error in DGT command: ${error.message}`);
                    await ctx.reply('⚠️ Error generating time table. Please try again.');
                }
                userStates.delete(userId);
                break;

            case STATES.AWAITING_CGT_INPUT:
                logger.info('CGT_INPUT', `Processing CGT command for input: ${input}`);
                const [cgtCity, cgtDate] = input.split(',').map(s => s.trim());
                
                if (!cgtCity || !cgtDate) {
                    await ctx.reply('⚠️ Invalid format. Please use: City, YYYY-MM-DD');
                    return;
                }
                
                if (!isValidDate(cgtDate)) {
                    await ctx.reply('⚠️ Invalid date format. Please use YYYY-MM-DD');
                    return;
                }

                try {
                    await handleCGTCommand(ctx, cgtCity, cgtDate);
                } catch (error) {
                    logger.error('CGT_COMMAND_ERROR', `Error in CGT command: ${error.message}`);
                    await ctx.reply('⚠️ Error generating combined table. Please try again.');
                }
                userStates.delete(userId);
                break;

            case STATES.UPDATE_ALL:
                if (!isValidTime(input)) {
                    await ctx.reply('⚠️ Invalid time format. Please use HH:mm (e.g., 08:00)');
                    return;
                }
                await saveUserPreferences(userId, { notificationTime: input });
                userStates.set(userId, STATES.AWAITING_CITY);
                await ctx.reply('✅ Notification time saved! Now please enter your city:');
                break;

           
        }
    } catch (error) {
        logger.error('MESSAGE_PROCESSING_ERROR', `Error processing message: ${error.message}`);
        await ctx.reply('⚠️ An error occurred. Please try again or use /cancel');
    }
});

// Export all necessary functions and constants
module.exports = {
    STATES,
    typeNames,
    preferenceCommands,
    handleGTCommand,
    handleDGTCommand,
    handleCGTCommand,
    scheduleUserNotifications,
    saveUserPreferences,
    initializeSchedules,
    isValidTime,
    isValidDate,
    getTimezoneForCity
};
