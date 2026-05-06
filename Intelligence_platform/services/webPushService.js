// services/webPushService.js
// Sends Web Push notifications to users who have subscribed to disruption
// alerts for a specific route (stored in User.alert_prefs in MongoDB).
//
// Setup:
//   1. Generate VAPID keys once:  node -e "const wp = require('web-push'); console.log(wp.generateVAPIDKeys())"
//   2. Add to .env:
//        VAPID_PUBLIC_KEY=<your public key>
//        VAPID_PRIVATE_KEY=<your private key>
//        VAPID_MAILTO=mailto:your@email.com
//   3. The frontend uses VAPID_PUBLIC_KEY to register the service worker subscription.

const webpush = require('web-push');
const User    = require('../models/User');

// Lazily configure — only runs if VAPID keys are present.
// If keys are missing the service silently skips push sending
// so the rest of the app still works during local dev.
let vapidConfigured = false;

const configure = () => {
  if (vapidConfigured) return true;
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('⚠️  Web Push: VAPID keys not set. Push notifications disabled.');
    return false;
  }
  webpush.setVapidDetails(
    process.env.VAPID_MAILTO || 'mailto:admin@vazhi.in',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  vapidConfigured = true;
  return true;
};

/**
 * Sends a push notification to all users subscribed to a given gtfsRouteId.
 *
 * @param {string} gtfsRouteId  - The GTFS route ID of the disrupted route
 * @param {object} payload      - { title, body, severity, routeId }
 */
const sendAlertToSubscribers = async (gtfsRouteId, payload) => {
  if (!configure()) return;

  try {
    // Find all users who subscribed to this route AND have a push subscription saved
    const users = await User.find({
      alert_prefs:       gtfsRouteId,
      push_subscription: { $ne: null }
    }).select('push_subscription name');

    if (users.length === 0) return;

    console.log(`📲 Sending push to ${users.length} subscriber(s) for route ${gtfsRouteId}`);

    const notification = JSON.stringify({
      title:    payload.title || `Vazhi Alert: Route ${gtfsRouteId}`,
      body:     payload.body  || payload.message,
      severity: payload.severity,
      routeId:  gtfsRouteId,
      icon:     '/icon-192.png',   // Adjust to your PWA icon path
      badge:    '/badge-72.png',
      tag:      `alert-${gtfsRouteId}`,  // Replaces previous notification for same route
      data: {
        url: `/?city=kochi&route=${gtfsRouteId}`
      }
    });

    const results = await Promise.allSettled(
      users.map(user =>
        webpush.sendNotification(user.push_subscription, notification)
      )
    );

    // Clean up invalid subscriptions (expired/unsubscribed endpoints)
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        const statusCode = result.reason?.statusCode;
        // 404 = endpoint gone, 410 = subscription expired — both mean remove it
        if (statusCode === 404 || statusCode === 410) {
          console.log(`🧹 Removing expired push subscription for user ${users[i]._id}`);
          await User.findByIdAndUpdate(users[i]._id, { push_subscription: null });
        } else {
          console.error(`❌ Push send failed for user ${users[i]._id}:`, result.reason?.message);
        }
      }
    }

  } catch (err) {
    console.error('❌ Web Push service error:', err.message);
  }
};

module.exports = { sendAlertToSubscribers };