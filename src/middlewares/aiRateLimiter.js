const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

// Separate limiter for AI requests: 30 requests per minute per user
const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  keyGenerator: (req) => (req.user && req.user.id) ? req.user.id : ipKeyGenerator(req),
  message: { message: 'Too many AI requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = aiRateLimiter;
