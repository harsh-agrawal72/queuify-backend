const admin = require('firebase-admin');
const path = require('path');

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log('Firebase Admin SDK: Using Environment Variable');
  } catch (e) {
    console.error('Firebase Admin SDK: Failed to parse FIREBASE_SERVICE_ACCOUNT env var', e.message);
  }
}

if (!serviceAccount) {
  try {
    serviceAccount = require('./firebase-service-account.json');
    console.log('Firebase Admin SDK: Using Local File');
  } catch (e) {
    console.warn('Firebase Admin SDK: No configuration found. Push notifications will be disabled.');
  }
}

if (serviceAccount && !admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log('Firebase Admin SDK Initialized Successfully');
}

module.exports = admin;
