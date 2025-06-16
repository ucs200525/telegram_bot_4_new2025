const { MongoClient } = require('mongodb');
const logger = require('./logger');

const uri = "mongodb://localhost:27017";
const client = new MongoClient(uri);
const dbName = 'panchangBot';

let db;

async function connectDB() {
    try {
        await client.connect();
        db = client.db(dbName);
        logger.info('DB_CONNECT', 'Connected to MongoDB');
        
        // Create indexes
        await db.collection('userPreferences').createIndex({ userId: 1 }, { unique: true });
        
    } catch (error) {
        logger.error('DB_CONNECT_ERROR', `MongoDB connection error: ${error.message}`);
        throw error;
    }
}

const dbOps = {
    savePreferences: async (userId, preferences) => {
        try {
            const result = await db.collection('userPreferences').updateOne(
                { userId },
                { 
                    $set: {
                        ...preferences,
                        lastUpdated: new Date()
                    }
                },
                { upsert: true }
            );
            logger.info('DB_SAVE', `Preferences saved for user ${userId}`);
            return result;
        } catch (error) {
            logger.error('DB_SAVE_ERROR', `Error saving preferences: ${error.message}`);
            throw error;
        }
    },

    getPreferences: async (userId) => {
        try {
            const prefs = await db.collection('userPreferences').findOne({ userId });
            return prefs;
        } catch (error) {
            logger.error('DB_GET_ERROR', `Error getting preferences: ${error.message}`);
            throw error;
        }
    },

    getAllSubscribed: async () => {
        try {
            return await db.collection('userPreferences')
                .find({ isSubscribed: true })
                .toArray();
        } catch (error) {
            logger.error('DB_GET_SUBSCRIBED_ERROR', `Error getting subscribed users: ${error.message}`);
            throw error;
        }
    }
};

// Connect when module is loaded
connectDB().catch(console.error);

module.exports = dbOps;
