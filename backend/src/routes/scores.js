const router = require('express').Router();
const db     = require('../db/pool');
const cache  = require('../cache');

// GET /api/scores?league=NBA&limit=60
// Returns completed + live matches with rich JSON including external_meta
router.get('/', async (req, res, next) => {
  try {
    const { league = 'All', limit = 60, status = 'all' } = req.query;
    const cacheKey = `scores:${league}:${limit}:${status}`;
    const cached   = cache.get(cacheKey);
    if (cached) return res.json({ ...cached, fromCache: true });

    let sql = `
      SELECT
        m.id,
        m.external_id,
        l.name          AS league,
        l.sport,
        ht.name         AS home_team,
        ht.short_name   AS home_abbr,
        ht.logo_url     AS home_logo,
        at.name         AS away_team,
        at.short_name   AS away_abbr,
        at.logo_url     AS away_logo,
        r.home_score,
        r.away_score,
        wt.name         AS winner_team,
        m.match_date,
        m.status,
        m.venue,
        m.home_win_prob,
        m.away_win_prob,
        m.draw_prob,
        m.external_meta
      FROM   matches m
      JOIN   leagues l  ON m.league_id      = l.id
      JOIN   teams   ht ON m.home_team_id   = ht.id
      JOIN   teams   at ON m.away_team_id   = at.id
      LEFT JOIN results r  ON m.id          = r.match_id
      LEFT JOIN teams   wt ON r.winner_team_id = wt.id
      WHERE  1=1
    `;
    const params = [];

    if (status === 'live') {
      sql += ' AND m.status = ?'; params.push('live');
    } else if (status === 'completed') {
      sql += ' AND m.status = ?'; params.push('completed');
    } else {
      sql += ' AND m.status IN (\'completed\',\'live\')';
    }

    if (league !== 'All') {
      sql += ' AND l.name = ?'; params.push(league);
    }

    sql += ' ORDER BY m.match_date DESC LIMIT ' + parseInt(limit);

    const rows = await db.query(sql, params);

    // Parse external_meta JSON
    const data = rows.map(r => ({
  ...r,
  external_meta: r.external_meta
    ? (typeof r.external_meta === 'string' ? JSON.parse(r.external_meta) : r.external_meta)
    : null,
}));

    const payload = { success: true, data, count: data.length, ts: new Date().toISOString() };
    cache.set(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

module.exports = router;


