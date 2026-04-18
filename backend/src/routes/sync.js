const router              = require('express').Router();
const { syncFootball }    = require('../services/footballApi');
const { syncNBA }         = require('../services/nbaApi');
const { syncNHL }         = require('../services/nhlApi');
const { syncCricket }     = require('../services/cricketApi');
const { requireApiKey }   = require('../middleware/auth');
const { syncLimiter }     = require('../middleware/rateLimiter');
const log                 = require('../utils/logger');

// POST /api/sync          — sync all sports
// POST /api/sync?sport=nba — sync one sport
router.post('/', requireApiKey, syncLimiter, async (req, res, next) => {
  try {
    const { sport } = req.query;
    const results   = { football:0, nba:0, nhl:0, cricket:0, errors:[] };

    async function run(name, fn) {
      try {
        results[name] = await fn();
      } catch (e) {
        log.error(`[sync] ${name}`, e.message);
        results.errors.push(`${name}: ${e.message}`);
      }
    }

    if (!sport || sport === 'football') await run('football', syncFootball);
    if (!sport || sport === 'nba')      await run('nba',      syncNBA);
    if (!sport || sport === 'nhl')      await run('nhl',      syncNHL);
    if (!sport || sport === 'cricket')  await run('cricket',  syncCricket);

    res.json({ success: true, results, ts: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
