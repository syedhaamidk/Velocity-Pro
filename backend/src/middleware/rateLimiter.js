const rateLimit = require('express-rate-limit');

// Global: 200 req / 15 min per IP (generous for read-heavy dashboards)
const globalLimiter = rateLimit({
  windowMs:       15 * 60 * 1000,
  max:            200,
  standardHeaders: true,
  legacyHeaders:  false,
  message:        { success: false, error: 'Too many requests — please slow down.' },
});

// Sync endpoint: 5 triggers / 60 s per IP
// football-data.org free tier is 10 req/min — this prevents accidental bans
const syncLimiter = rateLimit({
  windowMs: 60_000,
  max:      5,
  message:  { success: false, error: 'Sync rate limit hit. Try again in 60 seconds.' },
});

module.exports = { globalLimiter, syncLimiter };
