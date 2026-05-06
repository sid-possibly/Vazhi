// services/mongoClient.js
// Singleton MongoDB connection using Mongoose.

const mongoose = require('mongoose');

const connectMongo = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected.');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1); // Fatal — exit if DB can't connect
  }
};



module.exports = { connectMongo };