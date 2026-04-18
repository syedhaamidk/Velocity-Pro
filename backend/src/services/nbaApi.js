/**
 * NBA Service  — ESPN unofficial API (no key required)
 * Endpoints:
 *   Scoreboard : https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard
 *   Summary    : https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event={id}
 */

const axios = require('axios');
const db    = require('../db/pool');
const cache = require('../cache');
const ws    = require('../websocket/liveUpdates');
const log   = require('../utils/logger');

const SB_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

async function get(url, params = {}) {
  const { data } = await axios.get(url, { params, timeout: 10_000 });
  return data;
}

async function upsertLeague(name, sport, extId) {
  await db.query(
    `INSERT INTO leagues (name, country, sport, external_id)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [name, 'USA', sport, extId]
  );
  const [row] = await db.query('SELECT id FROM leagues WHERE external_id = ?', [extId]);
  return row.id;
}

async function upsertTeam(name, shortName, leagueId, extId, logoUrl) {
  await db.query(
    `INSERT INTO teams (name, short_name, league_id, external_id, logo_url)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), logo_url = VALUES(logo_url)`,
    [name, shortName.slice(0, 10), leagueId, extId, logoUrl || '']
  );
  const [row] = await db.query('SELECT id FROM teams WHERE external_id = ?', [extId]);
  return row.id;
}

async function syncNBA() {
  log.info('[nbaApi] Starting NBA sync...');
  const d = await get(SB_URL);
  const events = d.events || [];

  const leagueId = await upsertLeague('NBA', 'basketball', 'nba');
  let synced = 0;

  for (const ev of events) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;

    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');
    if (!home || !away) continue;

    const homeId = await upsertTeam(
      home.team.displayName,
      home.team.abbreviation,
      leagueId,
      `nba_team_${home.team.id}`,
      home.team.logo
    );
    const awayId = await upsertTeam(
      away.team.displayName,
      away.team.abbreviation,
      leagueId,
      `nba_team_${away.team.id}`,
      away.team.logo
    );

    const statusName = ev.status?.type?.name || '';
    const status = statusName === 'STATUS_FINAL'       ? 'completed'
                 : statusName === 'STATUS_IN_PROGRESS' ? 'live'
                 : 'scheduled';

    const matchDate = ev.date ? ev.date.replace('T', ' ').replace('Z', '') : null;
    const extId = `nba_event_${ev.id}`;

    await db.query(
      `INSERT INTO matches
         (league_id, home_team_id, away_team_id, match_date, status, venue, external_id)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE status = VALUES(status)`,
      [leagueId, homeId, awayId, matchDate, status, comp.venue?.fullName || '', extId]
    );
    const [match] = await db.query('SELECT id FROM matches WHERE external_id = ?', [extId]);

    if (status === 'completed') {
      const hScore = parseInt(home.score) || 0;
      const aScore = parseInt(away.score) || 0;
      const winnerId = hScore > aScore ? homeId : aScore > hScore ? awayId : null;

      // Fetch summary for rich stats
      let topScorer = null;
      try {
        const sum = await get(
          'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary',
          { event: ev.id }
        );
        const leaders = sum.boxscore?.teams?.[0]?.leaders || [];
        const scorer  = leaders[0]?.leaders?.[0];
        if (scorer) topScorer = `${scorer.athlete?.shortName} ${scorer.displayValue}`;
      } catch {}

      await db.query(
        `INSERT INTO results (match_id, home_score, away_score, winner_team_id)
         VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE home_score=VALUES(home_score), away_score=VALUES(away_score), winner_team_id=VALUES(winner_team_id)`,
        [match.id, hScore, aScore, winnerId]
      );

      // Store rich stats in match.external_meta
      if (topScorer) {
        await db.query(
          'UPDATE matches SET external_meta = ? WHERE id = ?',
          [JSON.stringify({ topScorer }), match.id]
        );
      }
    }
    synced++;
  }

  log.info(`[nbaApi] Synced ${synced} NBA matches`);
  cache.invalidate('scores:');
  cache.invalidate('upcoming:');
  ws.emitScoresUpdate({ synced, source: 'nba' });
  return synced;
}

module.exports = { syncNBA };
