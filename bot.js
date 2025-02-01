const { Telegraf } = require('telegraf');
const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('pino')(); // Added logger for better logging

// Replace 'YOUR_BOT_API_TOKEN' with your actual API token
const bot = new Telegraf('7274941037:AAHIWiU5yvfIzo7eJWPu9S5CeJIid6ATEyM');

// Add state management
const userStates = new Map();

// Add loading messages constant
const LOADING_MESSAGES = {
    gt: '⏳ Calculating auspicious times...',
    dgt: '⏳ Fetching Drik Panchang data...',
};

// Function to fetch GeoName ID based on city
async function getGeoNameId(city) {
    const geoNamesUrl = `http://api.geonames.org/searchJSON?q=${city}&maxRows=1&username=ucs05`;
    try {
        const response = await axios.get(geoNamesUrl);
        console.log("Total Results Count:", response.data.totalResultsCount);
        if (response.data.geonames && response.data.geonames.length > 0) {
            const geoNameId = response.data.geonames[0].geonameId;
            logger.info("GeoName ID: " + geoNameId);
            return geoNameId;
        } else {
            throw new Error('City not found');
        }
    } catch (error) {
        console.error("Error fetching GeoName ID:", error.message);
        throw error;
    }
}

// Function to fetch Muhurat data for a given city and date
const fetchmuhurat = async (city, date) => {
    try {
        // Get the GeoName ID for the provided city
        const geoNameId = await getGeoNameId(city);

        // Format the URL to include the date and GeoName ID
        const url = `https://www.drikpanchang.com/muhurat/panchaka-rahita-muhurat.html?geoname-id=${geoNameId}&date=${date}`;

        // Fetch the HTML content from the website
        const response = await axios.get(url);

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
    logger.info(`Fetching Panchangam data for city: ${cityName} and date: ${currentDate}`);

    try {
        // Fetch sun times
        const sunTimesUrl = `http://localhost:4000/api/getSunTimesForCity/${cityName}/${currentDate}`;
        logger.info(`Constructed SunTimes API URL: ${sunTimesUrl}`);
        const sunTimesResponse = await axios.get(sunTimesUrl);
        logger.info('SunTimes Response:', sunTimesResponse.data);

        // Check for response status
        if (sunTimesResponse.status !== 200) {
            logger.error(`Error: SunTimes API returned status code ${sunTimesResponse.status}`);
            throw new Error(`SunTimes API returned status code ${sunTimesResponse.status}`);
        }

        const sunTimes = sunTimesResponse.data.sunTimes;

        // Fetch weekday
        const weekdayUrl = `http://localhost:4000/api/getWeekday/${currentDate}`;
        logger.info(`Constructed Weekday API URL: ${weekdayUrl}`);
        const weekdayResponse = await axios.get(weekdayUrl);
        logger.info('Weekday Response:', weekdayResponse.data);

        if (weekdayResponse.status !== 200) {
            logger.error(`Error: Weekday API returned status code ${weekdayResponse.status}`);
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
        logger.error('Error fetching Panchangam data:', error.message);
        logger.error('Stack Trace:', error.stack); // Log the error stack trace for debugging
        throw new Error('Failed to fetch Panchangam data');
    }
};

// Function to update the table based on Panchangam data
const updateTable = async (sunriseToday, sunsetToday, sunriseTmrw, weekday, currentDate) => {
    logger.info('Sending data to update table...');

    try {
        const tableUrl = `http://localhost:4000/api/update-table`;
        logger.info(`Constructed Update Table API URL: ${tableUrl}`);

        const tableResponse = await axios.post(tableUrl, {
            sunriseToday,
            sunsetToday,
            sunriseTmrw,
            weekday,
            is12HourFormat: true,  // Set as required
            currentDate,
            showNonBlue: false,  // Set as required
        });

        logger.info('Table data received:', tableResponse.data);
        return tableResponse.data;
    } catch (error) {
        logger.error('Error updating table:', error.message);
        logger.error('Stack Trace:', error.stack); // Log the error stack trace for debugging
        throw new Error('Failed to update table');
    }
};

// Command handlers - place these before hears handler
bot.command('start', async (ctx) => {
    const welcomeMessage = `🙏 *Welcome to Panchang Bot!* 🙏

I can help you find auspicious times and Muhurat timings.
Use /help to see all available commands.

Start by trying one of these commands:
/gt - Get good time intervals
/dgt - Get Drik Panchang timings`;
    
    await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
});

bot.command('help', async (ctx) => {
    const helpMessage = `✨ *Panchang Bot Commands* ✨
━━━━━━━━━━━━━━━━━━━━━━━━━
🔹 /start - Start the bot
🔹 /gt - Get good time intervals
🔹 /dgt - Get Drik Panchang timings
🔹 /cancel - Cancel current command
🔹 /help - Show this help message

📝 *How to use:*
1. Type /gt or /dgt
2. Enter city and date like this:
   CityName, YYYY-MM-DD

📌 *Example:*
Vijayawada, 2024-01-25

⚠️ *Note:* 
• Use /cancel to stop current command
• Dates must be in YYYY-MM-DD format
━━━━━━━━━━━━━━━━━━━━━━━━━`;

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

// Add this helper function at the top level
const isValidDate = (dateString) => {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date);
};

const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toISOString().split('T')[0];
};

// Modify the hears handler to only process messages when there's an active command
bot.hears(/.*/, async (messageCtx) => {
    const userId = messageCtx.message.from.id;
    const activeCommand = userStates.get(userId);
    const messageText = messageCtx.message.text;

    // Ignore commands in hears handler
    if (messageText.startsWith('/')) {
        return;
    }

    // Only process messages if there's an active command
    if (!activeCommand) {
        return;
    }

    try {
        const userInput = messageCtx.message.text;
        const [city, date] = userInput.split(',');

        if (!city || !date) {
            return messageCtx.reply('Invalid format. Please enter the city and date in the format: City, YYYY-MM-DD\nOr use /cancel to cancel the command.');
        }

        // Handle different commands
        switch (activeCommand) {
            case 'gt':
                await handleGTCommand(messageCtx, city.trim(), date.trim());
                break;
            case 'dgt':
                await handleDGTCommand(messageCtx, city.trim(), date.trim());
                break;
        }

        userStates.delete(userId); // Clear state after processing

    } catch (error) {
        logger.error('Error processing command:', error);
        messageCtx.reply('An error occurred. Please try again or use /cancel to start over.');
    }
});

// Handler for GT command
async function handleGTCommand(messageCtx, city, date) {
    try {
        // Send loading message
        const loadingMsg = await messageCtx.reply(LOADING_MESSAGES.gt);

        const userId = messageCtx.message.from.id;
        const activeCommand = userStates.get(userId);

        // If no active command or message is a command, ignore
        if (!activeCommand || messageCtx.message.text.startsWith('/')) {
            return;
        }

        const userInput = messageCtx.message.text;
        const [city, date] = userInput.split(',');

        if (!city || !date) {
            return messageCtx.reply('Invalid format. Please enter the city and date in the format: City, YYYY-MM-DD\nOr use /cancel to cancel the command.');
        }

        const cityName = city.trim();
        let currentDate = date.trim();

        // Validate date
        if (!isValidDate(currentDate)) {
            return messageCtx.reply('Invalid date format. Please use YYYY-MM-DD format.');
        }

        // Format date properly
        currentDate = formatDate(currentDate);

        logger.info(`Received /gt command. Fetching Panchangam data for city: ${cityName} and date: ${currentDate}`);

        // Constructing the API URL based on backend configuration
        const sunTimesUrl = `http://localhost:4000/api/getSunTimesForCity/${cityName}/${currentDate}`;
        logger.info(`Constructed SunTimes API URL: ${sunTimesUrl}`);
        const response = await axios.get(sunTimesUrl);

        if (response.status === 200) {
            const sun = response.data;
            logger.info("Fetched SunTimes data:", sun);

            // Fetch the weekday
            const weekdayUrl = `http://localhost:4000/api/getWeekday/${currentDate}`;
            logger.info(`Constructed Weekday API URL: ${weekdayUrl}`);
            const weekdayResponse = await axios.get(weekdayUrl);

            if (weekdayResponse.status === 200) {
                const weekday = weekdayResponse.data.weekday;

                // Send response to the user
                let responseMessage = `Good Timings for ${cityName} on ${currentDate}:\n\n`;
                responseMessage += `Sunrise Today: ${sun.sunTimes.sunriseToday}\n`;
                responseMessage += `Sunset Today: ${sun.sunTimes.sunsetToday}\n`;
                responseMessage += `Sunrise Tomorrow: ${sun.sunTimes.sunriseTmrw}\n`;
                responseMessage += `Weekday: ${weekday}\n`;

                messageCtx.reply(responseMessage);

                const fetchTableData = async () => {
                    try {
                        const requestData = {
                            currentDate: currentDate,
                            is12HourFormat: true,
                            showNonBlue: false,
                            sunriseTmrw: sun.sunTimes.sunriseTmrw,
                            sunriseToday: sun.sunTimes.sunriseToday,
                            sunsetToday: sun.sunTimes.sunsetToday,
                            weekday: weekday,
                        };

                        logger.info('Request Data:', JSON.stringify(requestData, null, 2));

                        const response = await axios.post(`http://localhost:4000/api/update-table`, requestData);
                        
                        // Log the content type and raw response
                        logger.info('Response Content-Type:', response.headers['content-type']);
                        logger.info('Raw Response:', typeof response.data, response.data);

                        let tableData;
                        try {
                            // If response.data is a string, try to parse it
                            tableData = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
                            
                            // If tableData has a specific property that contains the array, extract it
                            if (tableData.newTableData) {
                                tableData = tableData.newTableData;
                            }
                        } catch (parseError) {
                            logger.error('Error parsing response:', parseError);
                            throw new Error('Invalid response format from server');
                        }

                        // Validate the data structure
                        if (!Array.isArray(tableData)) {
                            logger.error('Invalid data structure:', typeof tableData, tableData);
                            throw new Error('Invalid response format: expected array');
                        }

                        // Process valid rows
                        const validData = tableData
                            .filter(row => row && typeof row === 'object')
                            .filter(row => row.start1 && row.end1)
                            .map(row => ({
                                start1: row.start1,
                                end1: row.end1,
                                start2: row.start2 || '',
                                end2: row.end2 || '',
                                isNextDay: row.start2?.includes('Feb') || false,
                                weekdayEffect: row.weekday	 || 'కార్యహాని'  // Add weekday effect
                            }));

                        if (validData.length === 0) {
                            throw new Error('No valid time intervals found in the data');
                        }

                        // Build a more readable message
                        let tableMessage = "✨ Auspicious Time Intervals ✨\n";
                        tableMessage += "━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";

                        validData.forEach((row, index) => {
                            // Main time interval
                            tableMessage += `${index + 1}. ⏰ ${row.start1} to ${row.end1}\n`;
                            
                            // Next day or second interval if exists
                            if (row.isNextDay && row.start2 && row.end2) {
                                tableMessage += `   └─ 📆 Next Day: ${row.start2} to ${row.end2}\n`;
                            } else if (row.start2 && row.end2) {
                                tableMessage += `   └─ 🕐 Second interval: ${row.start2} to ${row.end2}\n`;
                            }
                            
                            // Weekday effect with decorative line
                            tableMessage += `   └─ 🌟 Effect: ${row.weekdayEffect}\n`;
                            tableMessage += `   ─────────────────────\n\n`;
                        });

                        // Add footer
                        tableMessage += "━━━━━━━━━━━━━━━━━━━━━━━━━\n";
                        tableMessage += "💫 Choose your time wisely 💫\n";

                        await messageCtx.reply(tableMessage);

                    } catch (error) {
                        logger.error('Error in fetchTableData:', {
                            message: error.message,
                            stack: error.stack,
                            response: error.response?.data
                        });
                        await messageCtx.reply(`⚠️ Error: ${error.message}\n\nPlease try again later or contact support.`);
                    }
                };

                await fetchTableData();
            } else {
                logger.error(`Error: Weekday API returned status code ${weekdayResponse.status}`);
                messageCtx.reply('Sorry, there was an error fetching weekday data. Please try again later.');
            }
        } else {
            logger.error(`Error: SunTimes API returned status code ${response.status}`);
            messageCtx.reply('Sorry, there was an error fetching the Panchangam data. Please try again later.');
        }

        // Delete loading message after processing
        await loadingMsg.delete().catch(() => {});

        userStates.delete(userId); // Clear state after processing

    } catch (error) {
        logger.error('Error in /gt command:', error.message);
        logger.error('Stack Trace:', error.stack);
        messageCtx.reply('Sorry, there was an error fetching the Panchangam data. Please try again later.');
    }
}

// Handler for DGT command
async function handleDGTCommand(messageCtx, city, date) {
    try {
        // Send loading message
        const loadingMsg = await messageCtx.reply(LOADING_MESSAGES.dgt);
        
        const drikTable = await createDrikTable(city, date);

        // Delete loading message
        await loadingMsg.delete().catch(() => {});

        let responseMessage = `🕉️ *Drik Panchang Timings* 🕉️\n`;
        responseMessage += `📍 ${city} | 📅 ${date}\n`;
        responseMessage += `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        if (drikTable.length === 0) {
            responseMessage += "No muhurat data available for this date.\n";
        } else {
            drikTable.forEach((row, index) => {
                responseMessage += `${index + 1}. 📿 ${row.muhurat}\n`;
                if (row.category) {
                    responseMessage += `   └─ 📝 Category: ${row.category}\n`;
                }
                responseMessage += `   └─ ⏰ Time: ${row.time}\n`;
                responseMessage += `   ─────────────────────\n\n`;
            });
        }

        responseMessage += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        responseMessage += `🙏 Plan your activities accordingly 🙏\n`;

        await messageCtx.reply(responseMessage, { parse_mode: 'Markdown' });
    } catch (error) {
        logger.error('Error in DGT command:', error);
        await messageCtx.reply('⚠️ Error fetching Drik Panchang data. Please try again later.');
    }
}

// Create the webhook handler for Vercel
module.exports = async (req, res) => {
    try {
        // Verify the request is POST
        if (req.method !== 'POST') {
            res.status(200).json({ message: 'Panchang Bot is running!' });
            return;
        }

        // Handle the update
        await bot.handleUpdate(req.body);
        
        // Send success response
        res.status(200).json({ ok: true });
    } catch (error) {
        logger.error('Webhook error:', error);
        res.status(500).json({ 
            ok: false, 
            error: 'Failed to process update' 
        });
    }
};

// Add webhook error handling
bot.catch((err, ctx) => {
    logger.error('Bot error:', err);
    ctx.reply('⚠️ An error occurred. Please try again later.');
});

// Initialize webhook mode (for local testing)
if (process.env.NODE_ENV === 'development') {
    bot.launch().then(() => {
        logger.info('Bot is running in development mode...');
    }).catch((error) => {
        logger.error('Error launching bot:', error);
    });
} else {
    logger.info('Bot is running in webhook mode...');
}

// Export the bot instance for testing
module.exports.bot = bot;

const logger = require('pino')();
let bot = null; // Will be initialized with the bot instance

// State management
const userStates = new Map();

// Initialize bot reference
function init(botInstance) {
    bot = botInstance;
}

// Command handlers
async function handleGtCommand(ctx) {
    userStates.set(ctx.message.from.id, 'gt');
    await ctx.reply('Please enter city and date (e.g., Vijayawada, 2024-01-25)');
}

async function handleDgtCommand(ctx) {
    userStates.set(ctx.message.from.id, 'dgt');
    await ctx.reply('Please enter city and date (e.g., Vijayawada, 2024-01-25)');
}

async function handleCancelCommand(ctx) {
    const userId = ctx.message.from.id;
    if (userStates.has(userId)) {
        userStates.delete(userId);
        await ctx.reply('✅ Command cancelled');
    } else {
        await ctx.reply('No active command to cancel');
    }
}

// Message handler
async function handleTextMessage(ctx) {
    const userId = ctx.message.from.id;
    const activeCommand = userStates.get(userId);

    if (!activeCommand || ctx.message.text.startsWith('/')) {
        return;
    }

    try {
        const [city, date] = ctx.message.text.split(',').map(s => s.trim());
        
        if (!city || !date) {
            return ctx.reply('Please use format: City, YYYY-MM-DD');
        }

        // Show loading message
        const loadingMsg = await ctx.reply('⌛ Processing...');

        if (activeCommand === 'gt') {
            await handleGoodTimes(ctx, city, date);
        } else if (activeCommand === 'dgt') {
            await handleDrikPanchang(ctx, city, date);
        }

        // Clean up
        await loadingMsg.delete().catch(() => {});
        userStates.delete(userId);

    } catch (error) {
        logger.error('Error processing message:', error);
        await ctx.reply('⚠️ An error occurred. Please try again.');
    }
}

// ... rest of your existing helper functions ...

module.exports = {
    init,
    handleGtCommand,
    handleDgtCommand,
    handleCancelCommand,
    handleTextMessage,
    handleGoodTimes,     // Your existing function
    handleDrikPanchang,  // Your existing function
    userStates
};
