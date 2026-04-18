/**
 * NHL Service — Official NHL Stats API (no key required)
 * https://api-web.nhle.com/v1/scoreboard/now
 * https://api-web.nhle.com/v1/gamecenter/{id}/boxscore
 */

const axios = require('axios');
const db    = require('../db/pool');
const cache = require('../cache');
const ws    = require('../websocket/liveUpdates');
const log   = require('../utils/logger');

const BASE = 'https://api-web.nhle.com/v1';

async function get(url) {
  const { data } = await axios.get(url, { timeout: 10_000 });
  return data;
}

async function upsertLeague() {
  await db.query(
    `INSERT INTO leagues (name, country, sport, external_id)
     VALUES ('NHL','USA','hockey','nhl')
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    []
  );
  const [row] = await db.query('SELECT id FROM leagues WHERE external_id = ?', ['nhl']);
  return row.id;
}

async function upsertTeam(teamObj, leagueId) {
  const name     = teamObj?.name?.default || teamObj?.abbrev || 'Unknown';
  const abbrev   = teamObj?.abbrev || '???';
  const logo     = teamObj?.logo  || '';
  const extId    = `nhl_team_${teamObj?.id || abbrev}`;

  await db.query(
    `INSERT INTO teams (name, short_name, league_id, external_id, logo_url)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), logo_url = VALUES(logo_url)`,
    [name, abbrev.slice(0, 10), leagueId, extId, logo]
  );
  const [row] = await db.query('SELECT id FROM teams WHERE external_id = ?', [extId]);
  return row.id;
}

async function syncNHL() {
  log.info('[nhlApi] Starting NHL sync...');
  const d        = await get(`${BASE}/scoreboard/now`);
  const leagueId = await upsertLeague();
  let synced = 0;

  for (const day of (d.gamesByDate || [])) {
    for (const g of (day.games || [])) {
      const homeId = await upsertTeam(g.homeTeam, leagueId);
      const awayId = await upsertTeam(g.awayTeam, leagueId);

      const state  = g.gameState;
      const status = (state === 'OFF' || state === 'FINAL') ? 'completed'
                   : (state === 'LIVE' || state === 'CRIT') ? 'live'
                   : 'scheduled';

      const matchDate = g.startTimeUTC ? g.startTimeUTC.replace('T', ' ').replace('Z', '') : null;
      const extId = `nhl_game_${g.id}`;

      await db.query(
        `INSERT INTO matches
           (league_id, home_team_id, away_team_id, match_date, status, venue, external_id)
         VALUES (?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE status = VALUES(status)`,
        [leagueId, homeId, awayId, matchDate, status, g.venue?.default || '', extId]
      );
      const [match] = await db.query('SELECT id FROM matches WHERE external_id = ?', [extId]);

      if (status === 'completed') {
        const hScore = g.homeTeam?.score || 0;
        const aScore = g.awayTeam?.score || 0;
        const winnerId = hScore > aScore ? homeId : aScore > hScore ? awayId : null;

        // Determine OT/SO suffix
        const periodType = g.gameOutcome?.lastPeriodType;
        const suffix     = periodType === 'OT' ? 'OT' : periodType === 'SO' ? 'SO' : null;

        await db.query(
          `INSERT INTO results (match_id, home_score, away_score, winner_team_id)
           VALUES (?,?,?,?)
           ON DUPLICATE KEY UPDATE home_score=VALUES(home_score), away_score=VALUES(away_score), winner_team_id=VALUES(winner_team_id)`,
          [match.id, hScore, aScore, winnerId]
        );

        if (suffix) {
          await db.query(
            'UPDATE matches SET external_meta = ? WHERE id = ?',
            [JSON.stringify({ suffix }), match.id]
          );
        }
      }
      synced++;
    }
  }

  log.info(`[nhlApi] Synced ${synced} NHL games`);
  cache.invalidate('scores:');
  cache.invalidate('upcoming:');
  ws.emitScoresUpdate({ synced, source: 'nhl' });
  return synced;
}

module.exports = { syncNHL };
