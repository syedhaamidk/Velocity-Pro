/**
 * Cricket Service — CricAPI (free, 100 calls/day)
 * https://cricapi.com/register  → free key
 *
 * Endpoints used:
 *   currentMatches : https://api.cricapi.com/v1/currentMatches?apikey=KEY&offset=0
 *   scorecard      : https://api.cricapi.com/v1/match_scorecard?apikey=KEY&id=MATCH_ID
 */

const axios = require('axios');
const db    = require('../db/pool');
const cache = require('../cache');
const ws    = require('../websocket/liveUpdates');
const log   = require('../utils/logger');

const BASE = 'https://api.cricapi.com/v1';

async function get(url) {
  const { data } = await axios.get(url, { timeout: 15_000 });
  return data;
}

async function upsertLeague(name, extId) {
  await db.query(
    `INSERT INTO leagues (name, country, sport, external_id)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [name, 'India', 'cricket', extId]
  );
  const [row] = await db.query('SELECT id FROM leagues WHERE external_id = ?', [extId]);
  return row.id;
}

async function upsertTeam(name, leagueId) {
  const abbrev = name.split(' ').map(w => w[0]).join('').slice(0, 5).toUpperCase();
  const extId  = `cric_team_${name.toLowerCase().replace(/\s+/g, '_')}`;

  await db.query(
    `INSERT INTO teams (name, short_name, league_id, external_id)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [name, abbrev, leagueId, extId]
  );
  const [row] = await db.query('SELECT id FROM teams WHERE external_id = ?', [extId]);
  return row.id;
}

async function syncCricket() {
  const apiKey = process.env.CRICAPI_KEY;
  if (!apiKey) {
    log.info('[cricketApi] No CRICAPI_KEY — skipping cricket sync');
    return 0;
  }

  log.info('[cricketApi] Starting cricket sync...');

  const d = await get(`${BASE}/currentMatches?apikey=${apiKey}&offset=0`);
  if (d.status !== 'success') {
    log.warn('[cricketApi] API error:', d.message || d.status);
    return 0;
  }

  const matches  = (d.data || []).filter(m =>
    m.matchType?.toLowerCase().includes('t20') ||
    m.series_id || m.name?.includes('IPL')
  );

  let synced = 0;

  for (const m of matches) {
    if (!m.teams || m.teams.length < 2) continue;

    // Group by series — use series name or fallback
    const leagueName = m.series_name || m.matchType?.toUpperCase() || 'Cricket';
    const extLeague  = `cric_league_${(m.series_id || leagueName).toString().toLowerCase().replace(/\s+/g, '_')}`;
    const leagueId   = await upsertLeague(leagueName, extLeague);

    const homeId = await upsertTeam(m.teams[0], leagueId);
    const awayId = await upsertTeam(m.teams[1], leagueId);

    const matchEnded  = m.matchEnded || (m.status && /won|tied|draw/i.test(m.status));
    const matchLive   = m.matchStarted && !matchEnded;
    const status      = matchEnded ? 'completed' : matchLive ? 'live' : 'scheduled';

    const matchDate   = m.dateTimeGMT ? m.dateTimeGMT.replace('T', ' ').replace('Z', '') : null;
    const extId       = `cric_match_${m.id}`;

    await db.query(
      `INSERT INTO matches
         (league_id, home_team_id, away_team_id, match_date, status, venue, external_id)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE status = VALUES(status)`,
      [leagueId, homeId, awayId, matchDate, status, m.venue || '', extId]
    );
    const [match] = await db.query('SELECT id FROM matches WHERE external_id = ?', [extId]);

    if (status === 'completed' || status === 'live') {
      const scores = m.score || [];
      const inn1   = scores[0];
      const inn2   = scores[1];
      const hScore = inn2 ? parseInt(inn2.r) || 0 : inn1 ? parseInt(inn1.r) || 0 : 0;
      const aScore = inn1 ? parseInt(inn1.r) || 0 : 0;

      // Determine winner
      let winnerId = null;
      if (m.status) {
        if (m.status.startsWith(m.teams[0])) winnerId = homeId;
        else if (m.status.startsWith(m.teams[1])) winnerId = awayId;
      }

      await db.query(
        `INSERT INTO results (match_id, home_score, away_score, winner_team_id)
         VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE home_score=VALUES(home_score), away_score=VALUES(away_score), winner_team_id=VALUES(winner_team_id)`,
        [match.id, hScore, aScore, winnerId]
      );

      // Store rich cricket meta: innings scores, result string, match API id
      const meta = {
        cricApiId: m.id,
        inn1: inn1 ? `${inn1.r}/${inn1.w} (${inn1.o} ov)` : null,
        inn2: inn2 ? `${inn2.r}/${inn2.w} (${inn2.o} ov)` : null,
        result: m.status || null,
        matchType: m.matchType || null,
      };
      await db.query(
        'UPDATE matches SET external_meta = ? WHERE id = ?',
        [JSON.stringify(meta), match.id]
      );
    }

    synced++;
  }

  log.info(`[cricketApi] Synced ${synced} cricket matches`);
  cache.invalidate('scores:');
  cache.invalidate('upcoming:');
  ws.emitScoresUpdate({ synced, source: 'cricket' });
  return synced;
}

module.exports = { syncCricket };
