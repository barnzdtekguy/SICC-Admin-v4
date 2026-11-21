'use strict';
// Generates VAPID keys for browser push notifications. Paste the output into your environment.
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=mailto:you@yourchurch.org`);
