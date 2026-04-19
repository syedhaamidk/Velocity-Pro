/**
 * Cricket Service — CricAPI (free, 100 calls/day)
 * https://cricketdata.org → free key
 */
const axios = require('axios');
const db    = require('../db/pool');
const cache = require('../cache');
const ws    = require('../websocket/liveUpdates');
const log   = require('../utils/logger');

const BASE = 'https://api.cricapi.com/v1';

async function get(url) {
  const { data } = await axios.get(url, { timeout: 15000 });
  return data;
}

async function upsertLeague(name, extId) {
  await db.query(
    'INSERT INTO leagues (name, country, sport, external_id) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name)',
    [name, 'International', 'cricket', extId]
  );
  const [row] = await db.query('SELECT id FROM leagues WHERE external_id=?', [extId]);
  return row.id;
}

async function upsertTeam(name, leagueId) {
  const abbrev = name.split(' ').map(w => w[0]).join('').slice(0, 5).toUpperCase();
  const extId  = 'cric_team_' + name.toLowerCase().replace(/\s+/g, '_');
  await db.query(
    'INSERT INTO teams (name, short_name, league_id, external_id) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name)',
    [name, abbrev, leagueId, extId]
  );
  const [row] = await db.query('SELECT id FROM teams WHERE external_id=?', [extId]);
  return row.id;
}

// Detect if a match belongs to IPL
function detectLeague(m) {
  const name   = (m.name || '').toLowerCase();
  const series = (m.series_name || '').toLowerCase();
  const type   = (m.matchType || '').toLowerCase();

  if (series.includes('indian premier league') || series.includes('ipl') ||
      name.includes('ipl') || name.includes('indian premier league')) {
    return { name: 'IPL', extId: 'cric_league_ipl' };
  }
  if (series.includes('pakistan super league') || series.includes('psl')) {
    return { name: 'PSL', extId: 'cric_league_psl' };
  }
  if (series.includes('big bash') || series.includes('bbl')) {
    return { name: 'BBL', extId: 'cric_league_bbl' };
  }
  if (series.includes('caribbean premier') || series.includes('cpl')) {
    return { name: 'CPL', extId: 'cric_league_cpl' };
  }
  if (type === 'test' || series.includes('test')) {
    return { name: 'TEST', extId: 'cric_league_test' };
  }
  if (type === 'odi' || series.includes(' odi ') || series.includes('one day')) {
    return { name: 'ODI', extId: 'cric_league_odi' };
  }
  // Default: T20
  const lgName = m.series_name || m.matchType?.toUpperCase() || 'T20';
  const lgExtId = 'cric_league_' + lgName.toLowerCase().replace(/\s+/g, '_').slice(0, 30);
  return { name: 'T20', extId: lgExtId };
}

async function syncCricket() {
  const apiKey = process.env.CRICAPI_KEY;
  if (!apiKey) {
    log.info('[cricketApi] No CRICAPI_KEY — skipping cricket sync');
    return 0;
  }

  log.info('[cricketApi] Starting cricket sync...');

  const d = await get(BASE + '/currentMatches?apikey=' + apiKey + '&offset=0');
  if (d.status !== 'success') {
    log.warn('[cricketApi] API error:', d.message || d.status);
    return 0;
  }

  const matches = d.data || [];
  let synced = 0;

  for (const m of matches) {
    if (!m.teams || m.teams.length < 2) continue;

    const league   = detectLeague(m);
    const leagueId = await upsertLeague(league.name, league.extId);
    const homeId   = await upsertTeam(m.teams[0], leagueId);
    const awayId   = await upsertTeam(m.teams[1], leagueId);

    const matchEnded = m.matchEnded || (m.status && /won|tied|draw|no result/i.test(m.status));
    const matchLive  = m.matchStarted && !matchEnded;
    const status     = matchEnded ? 'completed' : matchLive ? 'live' : 'scheduled';

    const matchDate = m.dateTimeGMT ? m.dateTimeGMT.replace('T', ' ').replace('Z', '') : null;
    const extId     = 'cric_match_' + m.id;

    await db.query(
      'INSERT INTO matches (league_id, home_team_id, away_team_id, match_date, status, venue, external_id) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status)',
      [leagueId, homeId, awayId, matchDate, status, m.venue || '', extId]
    );
    const [match] = await db.query('SELECT id FROM matches WHERE external_id=?', [extId]);

    if (status === 'completed' || status === 'live') {
      const scores = m.score || [];
      const inn1   = scores[0];
      const inn2   = scores[1];

      // home team batted first = inn1, away team batted = inn2
      const hScore = inn1 ? parseInt(inn1.r) || 0 : 0;
      const aScore = inn2 ? parseInt(inn2.r) || 0 : 0;

      let winnerId = null;
      if (m.status) {
        if (m.status.toLowerCase().startsWith(m.teams[0].toLowerCase())) winnerId = homeId;
        else if (m.status.toLowerCase().startsWith(m.teams[1].toLowerCase())) winnerId = awayId;
      }

      await db.query(
        'INSERT INTO results (match_id, home_score, away_score, winner_team_id) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE home_score=VALUES(home_score), away_score=VALUES(away_score), winner_team_id=VALUES(winner_team_id)',
        [match.id, hScore, aScore, winnerId]
      );

      const meta = {
        cricApiId: m.id,
        inn1: inn1 ? inn1.r + '/' + inn1.w + ' (' + inn1.o + ' ov)' : null,
        inn2: inn2 ? inn2.r + '/' + inn2.w + ' (' + inn2.o + ' ov)' : null,
        result:    m.status || null,
        matchType: m.matchType || null,
      };
      await db.query('UPDATE matches SET external_meta=? WHERE id=?', [JSON.stringify(meta), match.id]);
    }

    synced++;
  }

  log.info('[cricketApi] Synced ' + synced + ' cricket matches');
  cache.invalidate('scores:');
  cache.invalidate('upcoming:');
  ws.emitScoresUpdate({ synced, source: 'cricket' });
  return synced;
}

module.exports = { syncCricket };
