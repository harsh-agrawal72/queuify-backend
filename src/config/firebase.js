const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require('./firebase-service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log('Firebase Admin SDK Initialized');
}

module.exports = admin;
