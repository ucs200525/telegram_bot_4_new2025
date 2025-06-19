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

// Initialize bot and state management
let bot = null;
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

const typeNames = {
    gt: 'Good Times Table',
    dgt: 'Drik Panchang Table',
    cgt: 'Combined Table'
};

// Preference commands configuration
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

// Command handlers
async function handleStartCommand(ctx) {
    const userId = ctx.message.from.id;
    userStates.delete(userId);
    await ctx.reply(`👋 Welcome to the Muhurat Bot!

This bot helps you find auspicious times for your activities based on Vedic astrology.

Available commands:
/gt - Get Good Times table
/dgt - Get Drik Panchang table
/cgt - Get Combined table
/subscribe - Set up daily notifications
/stop - Stop notifications
/status - Check your current settings
/help - Show this help message
/cancel - Cancel current operation

To get started, try /subscribe to set up daily notifications!`);
}

async function handleStopCommand(ctx) {
    const userId = ctx.message.from.id;
    userStates.delete(userId);
    
    try {
        if (activeSchedules.has(userId)) {
            activeSchedules.get(userId).cancel();
            activeSchedules.delete(userId);
        }
        
        await saveUserPreferences(userId, { isSubscribed: false });
        await ctx.reply('✅ Successfully unsubscribed from notifications.');
        
    } catch (error) {
        logger.error('STOP_ERROR', `Error stopping notifications: ${error.message}`);
        await ctx.reply('⚠️ Error stopping notifications. Please try again later.');
    }
}

async function handleStatusCommand(ctx) {
    const userId = ctx.message.from.id;
    userStates.delete(userId);
    
    try {
        const prefs = await db.getPreferences(userId);
        if (!prefs) {
            await ctx.reply('❌ No preferences found. Use /subscribe to set up notifications.');
            return;
        }

        const subscriptionStatus = prefs.isSubscribed ? '✅ Active' : '❌ Inactive';
        const types = prefs.subscriptionTypes || [];
        const typesList = types.map(type => typeNames[type]).join(', ') || 'None';

        const message = `🔔 Your Notification Settings

📍 City: ${prefs.city || 'Not set'}
⏰ Time: ${prefs.notificationTime || 'Not set'}
📅 Start Date: ${prefs.startDate || 'Not set'}
📊 Subscription Types: ${typesList}
📱 Status: ${subscriptionStatus}

Use /update_all to change all settings
Or use specific commands:
/change_city - Update city
/change_time - Update time
/change_date - Update date`;

        await ctx.reply(message);
        
    } catch (error) {
        logger.error('STATUS_ERROR', `Error getting status: ${error.message}`);
        await ctx.reply('⚠️ Error fetching your status. Please try again later.');
    }
}

async function handleHelpCommand(ctx) {
    const userId = ctx.message.from.id;
    userStates.delete(userId);
    
    const helpText = `🌟 Muhurat Bot Help

Main Commands:
📊 Time Tables:
/gt - Get Good Times table
/dgt - Get Drik Panchang table
/cgt - Get Combined table

🔔 Notifications:
/subscribe - Set up daily notifications
/stop - Stop notifications
/status - Check your current settings

⚙️ Preferences:
/change_city - Update your city
/change_time - Update notification time
/change_date - Update start date
/update_all - Update all preferences

Other Commands:
/help - Show this help message
/cancel - Cancel current operation

📝 To use GT, DGT, or CGT commands:
1. Send the command (e.g., /gt)
2. Enter city and date separated by comma:
   Example: Mumbai, 2025-06-19

Need more help? Contact @support_muhurat`;

    await ctx.reply(helpText);
}

async function handleCancelCommand(ctx) {
    const userId = ctx.message.from.id;
    userStates.delete(userId);
    await ctx.reply('✅ Current operation cancelled. Use /help to see available commands.');
}

async function handleSubscribeCommand(ctx) {
    const userId = ctx.message.from.id;
    userStates.set(userId, STATES.AWAITING_TIME);
    await ctx.reply('Please enter your preferred notification time (24-hour format, e.g., 08:00):');
}

async function handlePreferenceCommand(ctx, config) {
    const userId = ctx.message.from.id;
    userStates.set(userId, config.state);
    await ctx.reply(config.prompt);
}

async function handleUpdateAllCommand(ctx) {
    const userId = ctx.message.from.id;
    userStates.set(userId, STATES.AWAITING_TIME);
    await ctx.reply('Let\'s update all your preferences.\nFirst, enter your notification time (24-hour format, e.g., 08:00):');
}

// Add cleanup function
function cleanup() {
    if (activeSchedules.size > 0) {
        for (const [userId, job] of activeSchedules) {
            job.cancel();
        }
        activeSchedules.clear();
    }
    logger.info('Cleanup completed');
}

// Improved text message handler
async function handleTextMessage(ctx) {
    const userId = ctx.message.from.id;
    const userInput = ctx.message.text;
    const currentState = userStates.get(userId);

    // Ignore commands
    if (!currentState || userInput.startsWith('/')) return;

    try {
        switch (currentState) {
            case STATES.AWAITING_TIME:
                if (!isValidTime(userInput)) {
                    await ctx.reply('⚠️ Invalid time format. Please use HH:mm (e.g., 08:00)');
                    return;
                }
                await saveUserPreferences(userId, { notificationTime: userInput });
                userStates.set(userId, STATES.AWAITING_CITY);
                await ctx.reply('Great! Now please enter your city name:');
                break;

            case STATES.AWAITING_CITY:
                await saveUserPreferences(userId, { city: userInput });
                userStates.set(userId, STATES.AWAITING_DATE);
                await ctx.reply('Please enter start date (YYYY-MM-DD):');
                break;

            case STATES.AWAITING_DATE:
                if (!isValidDate(userInput)) {
                    await ctx.reply('⚠️ Invalid date format. Please use YYYY-MM-DD');
                    return;
                }
                await saveUserPreferences(userId, { startDate: userInput });
                userStates.set(userId, STATES.AWAITING_SUBSCRIBE_TYPE);
                await ctx.reply(`Please select the type of updates you want to receive:
1️⃣ GT - Good Times Table
2️⃣ DGT - Drik Panchang Table
3️⃣ CGT - Combined Table
4️⃣ GT+DGT
5️⃣ GT+CGT
6️⃣ ALL

Reply with the number (1-6):`);
                break;

            case STATES.AWAITING_SUBSCRIBE_TYPE:
                const validOptions = ['1', '2', '3', '4', '5', '6'];
                if (!validOptions.includes(userInput)) {
                    await ctx.reply('⚠️ Invalid option. Please choose a number from 1 to 6.');
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

                const selectedTypes = typeMap[userInput];
                await saveUserPreferences(userId, { 
                    subscriptionTypes: selectedTypes,
                    isSubscribed: true 
                });
                
                const prefs = await db.getPreferences(userId);
                await scheduleUserNotifications(userId, prefs);
                userStates.delete(userId);
                await ctx.reply('✅ All set! You will now receive daily updates for your selected types.');
                break;

            case STATES.AWAITING_GT_INPUT:
            case STATES.AWAITING_DGT_INPUT:
            case STATES.AWAITING_CGT_INPUT:
                const [city, date] = userInput.split(',').map(s => s.trim());
                
                if (!city || !date) {
                    await ctx.reply('⚠️ Please provide both city and date, separated by comma (e.g., Mumbai, 2025-06-19)');
                    return;
                }
                
                if (!isValidDate(date)) {
                    await ctx.reply('⚠️ Invalid date format. Please use YYYY-MM-DD');
                    return;
                }

                try {
                    switch (currentState) {
                        case STATES.AWAITING_GT_INPUT:
                            await handleGTCommand(ctx, city, date);
                            break;
                        case STATES.AWAITING_DGT_INPUT:
                            await handleDGTCommand(ctx, city, date);
                            break;
                        case STATES.AWAITING_CGT_INPUT:
                            await handleCGTCommand(ctx, city, date);
                            break;
                    }
                } catch (error) {
                    logger.error(`Error in ${currentState}:`, error);
                    await ctx.reply('⚠️ Error generating table. Please try again later.');
                }
                userStates.delete(userId);
                break;

            default:
                await ctx.reply('Use /help to see available commands');
                userStates.delete(userId);
        }
    } catch (error) {
        logger.error('Error handling text message:', error);
        await ctx.reply('Sorry, there was an error processing your request. Please try again.');
        userStates.delete(userId);
    }
}

// Move all bot command registrations inside init function
function init(botInstance) {
    bot = botInstance;
    logger.info('BOT_INIT', 'Bot initialized');
    
    // Register GT, DGT, CGT commands
    bot.command('gt', async (ctx) => {
        const userId = ctx.message.from.id;
        userStates.set(userId, STATES.AWAITING_GT_INPUT);
        await ctx.reply('Please enter city and date (e.g., Mumbai, 2025-06-19):');
    });

    bot.command('dgt', async (ctx) => {
        const userId = ctx.message.from.id;
        userStates.set(userId, STATES.AWAITING_DGT_INPUT);
        await ctx.reply('Please enter city and date (e.g., Mumbai, 2025-06-19):');
    });

    bot.command('cgt', async (ctx) => {
        const userId = ctx.message.from.id;
        userStates.set(userId, STATES.AWAITING_CGT_INPUT);
        await ctx.reply('Please enter city and date (e.g., Mumbai, 2025-06-19):');
    });

    // Register all command handlers with error handling
    const commands = {
        'start': handleStartCommand,
        'subscribe': handleSubscribeCommand,
        'stop': handleStopCommand,
        'status': handleStatusCommand,
        'help': handleHelpCommand,
        'cancel': handleCancelCommand,
        'update_all': handleUpdateAllCommand
    };

    // Register commands with error handling
    Object.entries(commands).forEach(([command, handler]) => {
        bot.command(command, async (ctx) => {
            try {
                await handler(ctx);
            } catch (error) {
                logger.error(`COMMAND_ERROR_${command.toUpperCase()}`, error.message);
                await ctx.reply('⚠️ Error processing command. Please try again.');
            }
        });
    });

    // Register preference commands
    Object.entries(preferenceCommands).forEach(([command, config]) => {
        bot.command(command, async (ctx) => {
            try {
                await handlePreferenceCommand(ctx, config);
            } catch (error) {
                logger.error(`PREFERENCE_ERROR_${command.toUpperCase()}`, error.message);
                await ctx.reply('⚠️ Error processing preference. Please try again.');
            }
        });
    });

    // Handle text messages with error handling
    bot.on('text', async (ctx) => {
        try {
            await handleTextMessage(ctx);
        } catch (error) {
            logger.error('TEXT_HANDLER_ERROR', error.message);
            await ctx.reply('⚠️ Error processing message. Please try again.');
        }
    });

    return bot;
}

// Remove the direct bot command registrations from outside init
// Delete or comment out these lines:
// bot.command('gt', async (ctx) => { ... });
// bot.command('dgt', async (ctx) => { ... });
// bot.command('cgt', async (ctx) => { ... });

// Export all required functions and objects
module.exports = {
    init,
    handleStartCommand,
    handleStopCommand,
    handleStatusCommand,
    handleHelpCommand,
    handleCancelCommand,
    handleTextMessage,
    handleGTCommand,
    handleDGTCommand,
    handleCGTCommand,
    handleSubscribeCommand,
    handleUpdateAllCommand,
    handlePreferenceCommand,
    userStates,
    activeSchedules,
    typeNames,
    saveUserPreferences,
    cleanup,
    initializeSchedules,
    STATES
};

// End of file
