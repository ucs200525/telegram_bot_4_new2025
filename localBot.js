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

// Replace 'YOUR_BOT_API_TOKEN' with your actual API token
const bot = new Telegraf('7274941037:AAHIWiU5yvfIzo7eJWPu9S5CeJIid6ATEyM');

// Add state management
const userStates = new Map();

// Add new state constants
const STATES = {
    AWAITING_TIME: 'awaiting_time',
    AWAITING_CITY: 'awaiting_city',
    AWAITING_DATE: 'awaiting_date',
    AWAITING_GT_INPUT: 'gt',
    AWAITING_DGT_INPUT: 'dgt',
    AWAITING_CGT_INPUT: 'cgt',
    UPDATE_ALL: 'update_all',
    AWAITING_SUBSCRIBE_CITY: 'subscribe_city',
    AWAITING_SUBSCRIBE_DATE: 'subscribe_date',
     AWAITING_SUBSCRIBE_TIME: 'subscribe_time',  // Add this
    AWAITING_SUBSCRIBE_TYPE: 'subscribe_type',
};

// Add typeNames constant here
const typeNames = {
    gt: 'Good Times Table',
    dgt: 'Drik Panchang Table',
    cgt: 'Combined Table'
};

// User preferences storage with MongoDB-like structure
const userPreferences = new Map();

// Active schedules tracking
const activeSchedules = new Map();

// Helper functions
// Helper function for time validation (HH:mm)
const isValidTime = (time) => {
    return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time);
};

// Add isValidDate helper function
const isValidDate = (dateString) => {
    const date = new Date(dateString);
    // Check if date is valid and follows YYYY-MM-DD format
    return date instanceof Date && !isNaN(date) && /^\d{4}-\d{2}-\d{2}$/.test(dateString);
};

const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toISOString().split('T')[0];
};

// Add scheduling functions
async function scheduleUserNotifications(userId, preferences) {
    if (activeSchedules.has(userId)) {
        activeSchedules.get(userId).cancel();
    }

    const [hours, minutes] = preferences.notificationTime.split(':');
    const rule = new schedule.RecurrenceRule();
    rule.hour = parseInt(hours);
    rule.minute = parseInt(minutes);

    const job = schedule.scheduleJob(rule, async () => {
        try {
            const prefs = await db.getPreferences(userId);
            if (!prefs?.isSubscribed) return;

            for (const type of prefs.subscriptionTypes) {
                const today = new Date().toISOString().split('T')[0];
                
                switch(type) {
                    case 'gt':
                        await handleGTCommand({ 
                            telegram: bot.telegram,
                            chat: { id: userId }
                        }, prefs.city, today);
                        break;
                    case 'dgt':
                        await handleDGTCommand({ 
                            telegram: bot.telegram,
                            chat: { id: userId }
                        }, prefs.city, today);
                        break;
                    case 'cgt':
                        await handleCGTCommand({ 
                            telegram: bot.telegram,
                            chat: { id: userId }
                        }, prefs.city, today);
                        break;
                }
            }

            logger.info('NOTIFICATION_SENT', `Sent daily updates to user ${userId}`);
        } catch (error) {
            logger.error('NOTIFICATION_ERROR', `Failed to send notification to user ${userId}: ${error.message}`);
        }
    });

    activeSchedules.set(userId, job);
    logger.info('SCHEDULE_SET', `Set notification schedule for user ${userId} at ${preferences.notificationTime}`);
}

// Replace existing saveUserPreferences function
const saveUserPreferences = async (userId, preferences) => {
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
};

// Add schedule initialization
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

// Function to fetch GeoName ID based on city
async function getGeoNameId(city) {
    const geoNamesUrl = `http://api.geonames.org/searchJSON?q=${city}&maxRows=1&username=ucs05`;
    try {
        const response = await axios.get(geoNamesUrl);
        logger.info('GEO_NAME_FETCH', `Total Results Count: ${response.data.totalResultsCount}`);
        if (response.data.geonames && response.data.geonames.length > 0) {
            const geoNameId = response.data.geonames[0].geonameId;
            logger.info('GEO_NAME_ID', `GeoName ID: ${geoNameId}`);
            return geoNameId;
        } else {
            throw new Error('City not found');
        }
    } catch (error) {
        logger.error('GEO_NAME_ERROR', `Error fetching GeoName ID: ${error.message}`);
        throw error;
    }
}

// Function to fetch Muhurat data for a given city and date
const fetchmuhurat = async (city, date) => {
    try {
        // Get the GeoName ID for the provided city
        const geoNameId = await getGeoNameId(city);
        // Convert date from YYYY-MM-DD to DD/MM/YYYY
        const [year, month, day] = date.split('-');
        const formattedDate = `${day}/${month}/${year}`;
        
        logger.info('DATE_FORMAT', `Converting date from ${date} to ${formattedDate}`);

        // Format the URL to include the date and GeoName ID
        const url = `https://www.drikpanchang.com/muhurat/panchaka-rahita-muhurat.html?geoname-id=${geoNameId}&date=${formattedDate}`;

        // Fetch the HTML content from the website
        const response = await axios.get(url);
        logger.info('fetchmuhurat', `Response: ${url}`);
        // Load the HTML content using cheerio
        const $ = cheerio.load(response.data);

        // Extract the required data from the table
        const muhuratData = [];

        // Loop through all the rows that contain the Muhurat information
        $('.dpMuhurtaRow').each((i, element) => {
            const muhurtaName = $(element).find('.dpMuhurtaName').text().trim();
            const muhurtaTime = $(element).find('.dpMuhurtaTime').text().trim();

            const [name, category] = muhurtaName.split(' - '); // Split name and category

            muhuratData.push({
                muhurat: name,
                category: category || '',
                time: muhurtaTime,
            });
        });

        return muhuratData; // Return the muhurat data
    } catch (error) {
        console.error('Error fetching Muhurat data:', error);
        throw new Error('Error fetching data');
    }
};

// Function to create the Drik Table
const createDrikTable = async (city, date) => {
    const filteredData = await fetchmuhurat(city, date);

    const drikTable = filteredData.map((row) => {
        const [startTime, endTime] = row.time.split(' to ');

        let endTimeWithoutDate, endDatePart;

        if (endTime.includes(', ')) {
            [endTimeWithoutDate, endDatePart] = endTime.split(', ');
        } else {
            endTimeWithoutDate = endTime;
            endDatePart = null;
        }

        const currentDate = new Date(date);
        let adjustedStartTime = startTime.includes('PM')
            ? `${startTime}`
            : startTime.includes('AM') && endTime.includes(',')
                ? `${endDatePart} , ${startTime}`
                : startTime;

        let adjustedEndTime = endTime.includes('AM') && endTime.includes(',')
            ? `${endDatePart} , ${endTimeWithoutDate}`
            : endTime.includes('PM')
                ? `${endTimeWithoutDate}`
                : endTime;

        const timeIntervalFormatted = `${adjustedStartTime} to ${adjustedEndTime}`;

        return {
            category: row.category,
            muhurat: row.muhurat,
            time: timeIntervalFormatted,
        };
    });

    return drikTable;
};

const getPanchangamData = async (cityName, currentDate) => {
    logger.info('PANCHANGAM_FETCH', `Fetching Panchangam data for city: ${cityName} and date: ${currentDate}`);

    try {
        // Fetch sun times
        const sunTimesUrl = `https://panchang-aik9.vercel.app/api/getSunTimesForCity/${cityName}/${currentDate}`;
        logger.info('SUN_TIMES_URL', `Constructed SunTimes API URL: ${sunTimesUrl}`);
        const sunTimesResponse = await axios.get(sunTimesUrl);
        logger.info('SUN_TIMES_RESPONSE', 'SunTimes Response:', sunTimesResponse.data);

        // Check for response status
        if (sunTimesResponse.status !== 200) {
            logger.error('SUN_TIMES_ERROR', `Error: SunTimes API returned status code ${sunTimesResponse.status}`);
            throw new Error(`SunTimes API returned status code ${sunTimesResponse.status}`);
        }

        const sunTimes = sunTimesResponse.data.sunTimes;

        // Fetch weekday
        const weekdayUrl = `https://panchang-aik9.vercel.app/api/getWeekday/${currentDate}`;
        logger.info('WEEKDAY_URL', `Constructed Weekday API URL: ${weekdayUrl}`);
        const weekdayResponse = await axios.get(weekdayUrl);
        logger.info('WEEKDAY_RESPONSE', 'Weekday Response:', weekdayResponse.data);

        if (weekdayResponse.status !== 200) {
            logger.error('WEEKDAY_ERROR', `Error: Weekday API returned status code ${weekdayResponse.status}`);
            throw new Error(`Weekday API returned status code ${weekdayResponse.status}`);
        }

        const weekday = weekdayResponse.data.weekday;

        return {
            sunriseToday: sunTimes.sunriseToday,
            sunsetToday: sunTimes.sunsetToday,
            sunriseTmrw: sunTimes.sunriseTmrw,
            weekday: weekday,
        };
    } catch (error) {
        logger.error('PANCHANGAM_ERROR', `Error fetching Panchangam data: ${error.message}`);
        logger.error('PANCHANGAM_STACK', `Stack Trace: ${error.stack}`);
        throw new Error('Failed to fetch Panchangam data');
    }
};

// Function to update the table based on Panchangam data
const updateTable = async (sunriseToday, sunsetToday, sunriseTmrw, weekday, currentDate) => {
    console.log('Sending data to update table...');

    try {
        const tableUrl = `https://panchang-aik9.vercel.app/api/update-table`;
        console.log(`Constructed Update Table API URL: ${tableUrl}`);

        const tableResponse = await axios.post(tableUrl, {
            sunriseToday,
            sunsetToday,
            sunriseTmrw,
            weekday,
            is12HourFormat: true,  // Set as required
            currentDate,
            showNonBlue: false,  // Set as required
        });

        console.log('Table data received:', tableResponse.data);
        return tableResponse.data;
    } catch (error) {
        logger.error('Error updating table:', error.message);
        logger.error('Stack Trace:', error.stack); // Log the error stack trace for debugging
        throw new Error('Failed to update table');
    }
};

// Command handlers - place these before hears handler
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

bot.command('subscribe', async (ctx) => {
    const userId = ctx.message.from.id;
    userStates.delete(userId);
    userStates.set(userId, STATES.AWAITING_SUBSCRIBE_TIME);
    const message = `Please enter the time you want to receive daily updates (24-hour format).

Format: HH:mm (e.g., 08:00)`;
    await ctx.reply(message);
});

// Add cancel command
bot.command('cancel', async (ctx) => {
    const userId = ctx.message.from.id;
    if (userStates.has(userId)) {
        userStates.delete(userId);
        await ctx.reply('✅ Current operation cancelled. What would you like to do next?');
    } else {
        await ctx.reply('No active operation to cancel.');
    }
});

// Add command handlers for preference management
const preferenceCommands = {
    'change_time': {
        state: STATES.AWAITING_TIME,
        prompt: 'Please enter your preferred time (24-hour format, e.g., 08:00):',
        validate: (input) => isValidTime(input),
        save: (userId, input) => saveUserPreferences(userId, { time: input })
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
    bot.command(command, async (ctx) => {
        const userId = ctx.message.from.id;
        userStates.set(userId, config.state);
        await ctx.reply(config.prompt);
    });
});

bot.command('update_all', async (ctx) => {
    const userId = ctx.message.from.id;
    userStates.set(userId, STATES.UPDATE_ALL);
    await ctx.reply('Let\'s update all your preferences.\nFirst, enter your preferred time (24-hour format, e.g., 08:00):');
});

bot.command('stop', async (ctx) => {
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

bot.command('status', async (ctx) => {
    const userId = ctx.message.from.id;
    try {
        const prefs = await db.getPreferences(userId);
        
        if (!prefs) {
            await ctx.reply('No preferences set. Use /start to set up your preferences.');
            return;
        }

        // Escape special characters and format the message properly
        const city = prefs.city ? prefs.city.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&') : 'Not set';
        const startDate = prefs.start_date || 'Not set';
        const lastUpdated = new Date(prefs.last_updated).toLocaleString();
        
        let subscribedUpdates = '';
        if (prefs.isSubscribed && prefs.subscriptionTypes) {
            subscribedUpdates = prefs.subscriptionTypes
                .map(t => typeNames[t])
                .join(', ')
                .replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
        }

        const statusMessage = `*📊 Your Current Settings*\n
🌆 City: ${city}
📅 Start Date: ${startDate}${prefs.isSubscribed ? `
⏰ Daily Updates: ${prefs.notification_time || 'Not set'}
📱 Subscribed Updates: ${subscribedUpdates || 'None'}` : '\n📱 Subscription Status: ❌ Not subscribed'}
🔄 Last Updated: ${lastUpdated}

*Available Commands:*
• /subscribe \\- Enable daily updates
• /stop \\- Disable updates
• /change\\_time \\- Update notification time
• /change\\_city \\- Change city
• /change\\_date \\- Modify start date`;
        
        await ctx.reply(statusMessage, { 
            parse_mode: 'MarkdownV2',
            disable_web_page_preview: true
        });
    } catch (error) {
        logger.error('STATUS_ERROR', `Error in status command: ${error.message}`);
        await ctx.reply('❌ Error retrieving your preferences. Please try again.');
    }
});

// Updated help command
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

// Remove all other /gt command handlers and use only this one
bot.command('gt', async (ctx) => {
    const userId = ctx.message.from.id;
    // Clear any existing state
    userStates.delete(userId);
    // Set new state
    userStates.set(userId, STATES.AWAITING_GT_INPUT);
    await ctx.reply('Please enter the city and date in the format: City, YYYY-MM-DD');
});

// Update the DGT command handler
bot.command('dgt', async (ctx) => {
    const userId = ctx.message.from.id;
    userStates.delete(userId);
    userStates.set(userId, STATES.AWAITING_DGT_INPUT);
    await ctx.reply('Please enter the city and date in the format: City, YYYY-MM-DD');
});

// Add CGT command handler
bot.command('cgt', async (ctx) => {
    const userId = ctx.message.from.id;
    userStates.delete(userId);
    userStates.set(userId, STATES.AWAITING_CGT_INPUT);
    await ctx.reply('Please enter the city and date in the format: City, YYYY-MM-DD');
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
                saveUserPreferences(userId, { time: input });
                userStates.set(userId, STATES.AWAITING_CITY);
                await ctx.reply('✅ Time saved! Now please enter your city:');
                break;

            case STATES.AWAITING_CITY:
                saveUserPreferences(userId, { city: input });
                userStates.set(userId, STATES.AWAITING_DATE);
                await ctx.reply('✅ City saved! Now enter start date (YYYY-MM-DD):');
                break;

            case STATES.AWAITING_DATE:
                if (!isValidDate(input)) {
                    await ctx.reply('⚠️ Invalid date format. Please use YYYY-MM-DD');
                    return;
                }
                saveUserPreferences(userId, { 
                    startDate: input,
                    isSubscribed: true 
                });
                userStates.delete(userId);
                await ctx.reply('✅ All preferences saved! You will now receive daily updates.');
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

            case STATES.AWAITING_SUBSCRIBE_TIME:
                if (!isValidTime(input)) {
                    await ctx.reply('⚠️ Invalid time format. Please use HH:mm (e.g., 08:00)');
                    return;
                }
                saveUserPreferences(userId, { notificationTime: input });
                userStates.set(userId, STATES.AWAITING_SUBSCRIBE_CITY);
                await ctx.reply('Time saved! Now please enter your city name:');
                break;

            case STATES.AWAITING_SUBSCRIBE_CITY:
                saveUserPreferences(userId, { city: input });
                userStates.set(userId, STATES.AWAITING_SUBSCRIBE_DATE);
                await ctx.reply('City saved! Now enter the start date (YYYY-MM-DD):');
                break;

            case STATES.AWAITING_SUBSCRIBE_DATE:
                if (!isValidDate(input)) {
                    await ctx.reply('⚠️ Invalid date format. Please use YYYY-MM-DD');
                    return;
                }
                saveUserPreferences(userId, { startDate: input });
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
                } catch (error) {
                    logger.error('SUBSCRIPTION_ERROR', error.message);
                    await ctx.reply('❌ Error saving subscription. Please try again.');
                }
                userStates.delete(userId);
                break;
        }
    } catch (error) {
        logger.error('MESSAGE_PROCESSING_ERROR', `Error processing message: ${error.message}`);
        await ctx.reply('⚠️ An error occurred. Please try again or use /cancel');
    }
});

// Function to handle GT command
async function handleGTCommand(messageCtx, city, date) {
    let loadingMessage = null;
    try {
        // Send loading message
        loadingMessage = await messageCtx.reply('⏳ Generating time table...');
        logger.info('GT_PROCESS', `Starting GT process for ${city} on ${date}`);

        // Prepare request data
        const requestData = {
            city: city,
            date: date,
            showNonBlue: false,
            is12HourFormat: true
        };

        // Fetch image from API with correct URL and headers
        const imageResponse = await axios({
            method: 'post',
            url: 'http://localhost:4000/api/getBharagvTable-image',
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

        // Delete loading message safely
        try {
            if (loadingMessage) {
                await messageCtx.telegram.deleteMessage(messageCtx.chat.id, loadingMessage.message_id);
            }
        } catch (e) {
            logger.warn('LOADING_MSG_DELETE', 'Could not delete loading message');
        }

        // Send the image with caption
        await messageCtx.replyWithPhoto(
            { source: Buffer.from(imageResponse.data) },
            { 
                caption: `🗓️ Good Times Table\n📍 ${city}\n📅 ${date}\n\n💫 Choose your time wisely!`,
                parse_mode: 'Markdown'
            }
        );

    } catch (error) {
        logger.error('GT_ERROR', `Error in GT command: ${error.message}`);
        
        // Clean up loading message safely
        try {
            if (loadingMessage) {
                await messageCtx.telegram.deleteMessage(messageCtx.chat.id, loadingMessage.message_id);
            }
        } catch (e) {
            logger.warn('LOADING_MSG_DELETE', 'Could not delete loading message during error');
        }
        
        // Send appropriate error message
        if (error.code === 'EPROTO' || error.code === 'ETIMEDOUT') {
            await messageCtx.reply('⚠️ Connection error. Please try again.');
        } else if (error.response?.status === 400) {
            await messageCtx.reply('⚠️ Invalid city or date format.');
        } else if (error.code === 'ECONNABORTED') {
            await messageCtx.reply('⚠️ Request timed out. Please try again.');
        } else {
            await messageCtx.reply('⚠️ Error generating time table. Please try again later.');
        }
    }
}

// Handler for DGT command
async function handleDGTCommand(messageCtx, city, date) {
    let loadingMessage = null;
    try {
        // Send loading message
        loadingMessage = await messageCtx.reply('⏳ Generating Drik Panchang table...');
        const [year, month, day] = date.split('-');
        const formattedDate = `${day}/${month}/${year}`;
        logger.info('DGT_PROCESS', `Starting DGT process for ${city} on ${formattedDate}`);

        // Prepare request data
        const requestData = {
            city: city,
            date: formattedDate,
            goodTimingsOnly: false
        };

        // Fetch image from API
        const imageResponse = await axios({
            method: 'post',
            url: 'http://localhost:4000/api/getDrikTable-image',
            data: requestData,
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'image/*'
            }
        });

        logger.info('DGT_IMAGE', `Image received for ${city}`);

        // Delete loading message safely
        try {
            if (loadingMessage) {
                await messageCtx.telegram.deleteMessage(messageCtx.chat.id, loadingMessage.message_id);
            }
        } catch (e) {
            logger.warn('LOADING_MSG_DELETE', 'Could not delete loading message');
        }

        // Send the image with caption
        await messageCtx.replyWithPhoto(
            { source: Buffer.from(imageResponse.data) },
            { 
                caption: `✨ Drik Panchang Timings\n📍 ${city}\n📅 ${date}\n\n💫 Plan your activities accordingly!`,
                parse_mode: 'Markdown'
            }
        );

    } catch (error) {
        logger.error('DGT_ERROR', `Error in DGT command: ${error.message}`);
        
        // Clean up loading message safely
        try {
            if (loadingMessage) {
                await messageCtx.telegram.deleteMessage(messageCtx.chat.id, loadingMessage.message_id);
            }
        } catch (e) {
            logger.warn('LOADING_MSG_DELETE', 'Could not delete loading message during error');
        }
        
        // Send appropriate error message
        if (error.code === 'ECONNREFUSED') {
            await messageCtx.reply('⚠️ Server connection failed. Please try again later.');
        } else if (error.response?.status === 400) {
            await messageCtx.reply('⚠️ Invalid city or date format.');
        } else if (error.code === 'ECONNABORTED') {
            await messageCtx.reply('⚠️ Request timed out. Please try again.');
        } else {
            await messageCtx.reply('⚠️ Error generating Drik Panchang table. Please try again later.');
        }
        throw error;
    }
}

// Simplified CGT command handler
async function handleCGTCommand(messageCtx, city, date) {
    let loadingMessage = null;
    try {
        // Send loading message
        loadingMessage = await messageCtx.reply('⏳ Generating combined time table...');
        logger.info('CGT_PROCESS', `Starting CGT process for ${city} on ${date}`);
        const [year, month, day] = date.split('-');
        const formattedDate = `${day}/${month}/${year}`;
        // First fetch muhurat data
        const muhuratResponse = await axios.get(
            `http://localhost:4000/api/getDrikTable?city=${city}&date=${formattedDate}&goodTimingsOnly=true`
        );
        if (muhuratResponse.status !== 200) throw new Error('Failed to fetch muhurat data');
        const muhuratData = muhuratResponse.data;
        logger.info('CGT_MUHURAT', 'Fetched muhurat data');

        // Then fetch panchangam data
        const panchangamResponse = await axios.get(
            `http://localhost:4000/api/getBharagvTable?city=${city}&date=${date}&showNonBlue=true&is12HourFormat=true`
        );
        if (panchangamResponse.status !== 200) throw new Error('Failed to fetch panchangam data');
        const panchangamData = panchangamResponse.data;
        logger.info('CGT_PANCHANGAM', 'Fetched panchangam data');

        // Now make the image request with all required data
        const imageResponse = await axios({
            method: 'post',
            url: 'http://localhost:4000/api/combine-image',
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

        // Delete loading message
        if (loadingMessage) {
            await messageCtx.telegram.deleteMessage(messageCtx.chat.id, loadingMessage.message_id)
                .catch(() => {});
        }

        // Send the image
        await messageCtx.replyWithPhoto(
            { source: Buffer.from(imageResponse.data) },
            { 
                caption: `🎯 Combined Times Table\n📍 ${city}\n📅 ${date}\n\n💫 Plan your activities wisely!`,
                parse_mode: 'Markdown'
            }
        );

    } catch (error) {
        logger.error('CGT_ERROR', `Error in CGT command: ${error.message}`);
        
        if (loadingMessage) {
            await messageCtx.telegram.deleteMessage(messageCtx.chat.id, loadingMessage.message_id)
                .catch(() => {});
        }
        
        if (error.response?.status === 400) {
            await messageCtx.reply('⚠️ Invalid data format. Please check city and date.');
        } else if (error.code === 'ECONNREFUSED') {
            await messageCtx.reply('⚠️ Server connection failed. Please try again later.');
        } else {
            await messageCtx.reply('⚠️ Error generating combined table. Please try again later.');
        }
    }
}

bot.launch().then(async () => {
    logger.info('BOT_RUNNING', 'Bot is running...');
    await initializeSchedules();
}).catch((error) => {
    logger.error('BOT_LAUNCH_ERROR', `Error launching bot: ${error.message}`);
    logger.error('BOT_LAUNCH_STACK', `Stack Trace: ${error.stack}`);
});

// Add cleanup handlers
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
