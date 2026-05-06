// models/User.js
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password_hash: {
    type: String,
    required: true
  },
  saved_routes: [{ type: String }],
  alert_prefs:  [{ type: String }],
  // Phase 2, Task 9: Store Web Push Subscription
  push_subscription: {
    type: Object,
    default: null
  }
}, { timestamps: true });

userSchema.pre('save', async function () {
  if (!this.isModified('password_hash')) return;
  const salt = await bcrypt.genSalt(10);
  this.password_hash = await bcrypt.hash(this.password_hash, salt);
});

userSchema.methods.comparePassword = async function (plainPassword) {
  return bcrypt.compare(plainPassword, this.password_hash);
};

module.exports = mongoose.model('User', userSchema);