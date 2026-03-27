const config = require('./src/config/config');
console.log('Email Enabled Config:', config.email.enabled);
console.log('Type of Email Enabled:', typeof config.email.enabled);
console.log('ENABLE_EMAIL from process.env:', process.env.ENABLE_EMAIL);
