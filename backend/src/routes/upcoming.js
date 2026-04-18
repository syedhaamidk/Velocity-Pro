const router = require('express').Router();
const db     = require('../db/pool');
const cache  = require('../cache');

// GET /api/upcoming?league=EPL&limit=30
router.get('/', async (req, res, next) => {
  try {
    const { league='All', limit=30 } = req.query;
    const cacheKey = `upcoming:${league}:${limit}`;
    const cached   = cache.get(cacheKey);
    if (cached) return res.json({ ...cached, fromCache: true });

    let sql = `
      SELECT
        m.id,
        m.external_id,
        l.name        AS league,
        l.sport,
        ht.name       AS home_team,
        ht.short_name AS home_abbr,
        ht.logo_url   AS home_logo,
        at.name       AS away_team,
        at.short_name AS away_abbr,
        at.logo_url   AS away_logo,
        m.match_date,
        m.venue,
        m.status,
        m.home_win_prob,
        m.away_win_prob,
        m.draw_prob
      FROM   matches m
      JOIN   leagues l  ON m.league_id    = l.id
      JOIN   teams   ht ON m.home_team_id = ht.id
      JOIN   teams   at ON m.away_team_id = at.id
      WHERE  m.status = 'scheduled'
        AND  m.match_date > NOW()
    `;
    const params = [];
    if (league !== 'All') { sql += ' AND l.name = ?'; params.push(league); }
    sql += ' ORDER BY m.match_date ASC LIMIT ' + parseInt(limit);

    const rows    = await db.query(sql, params);
    const payload = { success: true, data: rows, count: rows.length, ts: new Date().toISOString() };
    cache.set(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

