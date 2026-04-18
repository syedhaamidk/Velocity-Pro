const router = require('express').Router();
const db     = require('../db/pool');
const cache  = require('../cache');

// GET /api/stats/high-scoring
router.get('/high-scoring', async (req, res, next) => {
  try {
    const cached = cache.get('stats:high-scoring');
    if (cached) return res.json({ ...cached, fromCache: true });

    const rows = await db.query(`
      SELECT
        m.id,
        l.name  AS league,
        ht.name AS home_team,
        at.name AS away_team,
        r.home_score,
        r.away_score,
        (r.home_score + r.away_score) AS total_score
      FROM   matches m
      JOIN   leagues l  ON m.league_id    = l.id
      JOIN   teams   ht ON m.home_team_id = ht.id
      JOIN   teams   at ON m.away_team_id = at.id
      JOIN   results r  ON m.id           = r.match_id
      ORDER  BY total_score DESC
      LIMIT  10
    `);
    const payload = { success: true, data: rows };
    cache.set('stats:high-scoring', payload);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/team-performance
router.get('/team-performance', async (req, res, next) => {
  try {
    const cached = cache.get('stats:team-performance');
    if (cached) return res.json({ ...cached, fromCache: true });

    const rows = await db.query(`
      SELECT
        t.name  AS team,
        l.name  AS league,
        COUNT(*) AS total_wins,
        ROUND(
          COUNT(*) * 100.0 /
          NULLIF((
            SELECT COUNT(*) FROM matches m2
            WHERE  m2.home_team_id = t.id OR m2.away_team_id = t.id
          ), 0), 1
        ) AS win_rate_pct
      FROM   results r
      JOIN   teams   t ON r.winner_team_id = t.id
      JOIN   matches m ON r.match_id       = m.id
      JOIN   leagues l ON m.league_id      = l.id
      GROUP  BY t.id, t.name, l.name
      ORDER  BY total_wins DESC
      LIMIT  20
    `);
    const payload = { success: true, data: rows };
    cache.set('stats:team-performance', payload);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
