const { MongoClient } = require('mongodb');
const logger = require('./logger');

const uri = "mongodb://localhost:27017";
const client = new MongoClient(uri);
const dbName = 'panchangBot';

class Database {
    constructor() {
        this.client = null;
        this.db = null;
    }

    async connect() {
        try {
            this.client = await client.connect();
            this.db = this.client.db(dbName);
            await this.db.collection('userPreferences').createIndex({ userId: 1 }, { unique: true });
            logger.info('DB_CONNECT', 'Connected to MongoDB successfully');
        } catch (error) {
            logger.error('DB_CONNECT_ERROR', `MongoDB connection error: ${error.message}`);
            throw error;
        }
    }

    async savePreferences(userId, preferences) {
        if (!this.db) await this.connect();
        
        try {
            const result = await this.db.collection('userPreferences').updateOne(
                { userId: userId.toString() },
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
    }

    async getPreferences(userId) {
        if (!this.db) await this.connect();
        
        try {
            return await this.db.collection('userPreferences').findOne({ 
                userId: userId.toString() 
            });
        } catch (error) {
            logger.error('DB_GET_ERROR', `Error getting preferences: ${error.message}`);
            throw error;
        }
    }

    async getAllSubscribed() {
        if (!this.db) await this.connect();
        
        try {
            return await this.db.collection('userPreferences')
                .find({ isSubscribed: true })
                .toArray();
        } catch (error) {
            logger.error('DB_GET_SUBSCRIBED_ERROR', `Error getting subscribed users: ${error.message}`);
            throw error;
        }
    }

    async close() {
        if (this.client) {
            await this.client.close();
            this.client = null;
            this.db = null;
            logger.info('DB_CLOSE', 'MongoDB connection closed');
        }
    }
}

// Create and export a single instance
const database = new Database();

// Connect when module is loaded
database.connect().catch(error => {
    logger.error('DB_INIT_ERROR', `Failed to initialize database: ${error.message}`);
});

module.exports = database;