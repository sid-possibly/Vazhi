// models/RefreshToken.js
const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // family_id groups all tokens from the same login session.
  // If a token from this family is reused, the entire family is revoked.
  family_id: {
    type: String,
    required: true
  },
  token_hash: {
    type: String,
    required: true
  },
  is_revoked: {
    type: Boolean,
    default: false
  },
  expires_at: {
    type: Date,
    required: true
  }
}, { timestamps: true });

// Auto-delete expired tokens from MongoDB
refreshTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);