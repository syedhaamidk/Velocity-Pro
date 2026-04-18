/**
 * Football Service
 * Primary  : ESPN unofficial API (no key — EPL + UCL always work)
 * Secondary: football-data.org v4 (set FOOTBALL_DATA_API_KEY for richer data)
 */
const axios = require('axios');
const db    = require('../db/pool');
const cache = require('../cache');
const ws    = require('../websocket/liveUpdates');
const log   = require('../utils/logger');

const FD_BASE = 'https://api.football-data.org/v4';

const FD_LEAGUE_MAP = {
  2021: { name:'EPL',        extId:'epl',        country:'England' },
  2001: { name:'UCL',        extId:'ucl',        country:'Europe'  },
  2014: { name:'La Liga',    extId:'laliga',     country:'Spain'   },
  2002: { name:'Bundesliga', extId:'bundesliga', country:'Germany' },
  2019: { name:'Serie A',    extId:'seriea',     country:'Italy'   },
  2015: { name:'Ligue 1',    extId:'ligue1',     country:'France'  },
};

const ESPN_LEAGUES = [
  { espnSlug:'eng.1',          name:'EPL', country:'England', extId:'epl' },
  { espnSlug:'UEFA.CHAMPIONS', name:'UCL', country:'Europe',  extId:'ucl' },
];

async function get(url, cfg) {
  cfg = cfg || {};
  const { data } = await axios.get(url, Object.assign({ timeout:12000 }, cfg));
  return data;
}

async function upsertLeague(name, country, sport, extId) {
  await db.query(
    'INSERT INTO leagues (name,country,sport,external_id) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name)',
    [name, country, sport, extId]
  );
  const [r] = await db.query('SELECT id FROM leagues WHERE external_id=?', [extId]);
  return r.id;
}

async function upsertTeam(name, short, leagueId, extId, logo) {
  const safeLogo = logo || '';
  await db.query(
    'INSERT INTO teams (name,short_name,league_id,external_id,logo_url) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name)',
    [name, (short||name).slice(0,10), leagueId, extId, safeLogo]
  );
  const [r] = await db.query('SELECT id FROM teams WHERE external_id=?', [extId]);
  return r.id;
}

async function syncESPN(league) {
  const d = await get('https://site.api.espn.com/apis/site/v2/sports/soccer/' + league.espnSlug + '/scoreboard');
  const lgId = await upsertLeague(league.name, league.country, 'football', league.extId);
  let n = 0;
  const events = d.events || [];
  for (let i = 0; i < events.length; i++) {
    const ev   = events[i];
    const comp = ev.competitions && ev.competitions[0];
    if (!comp) continue;
    const competitors = comp.competitors || [];
    let home = null, away = null;
    for (let j = 0; j < competitors.length; j++) {
      if (competitors[j].homeAway === 'home') home = competitors[j];
      if (competitors[j].homeAway === 'away') away = competitors[j];
    }
    if (!home || !away) continue;

    const hId = await upsertTeam(home.team.displayName, home.team.abbreviation, lgId, 'espn_t_'+home.team.id, home.team.logo||'');
    const aId = await upsertTeam(away.team.displayName, away.team.abbreviation, lgId, 'espn_t_'+away.team.id, away.team.logo||'');

    const sn = ev.status && ev.status.type ? ev.status.type.name : '';
    const st = sn === 'STATUS_FINAL' ? 'completed' : sn === 'STATUS_IN_PROGRESS' ? 'live' : 'scheduled';
    const dt = ev.date ? ev.date.replace('T',' ').replace('Z','') : null;
    const ext = 'espn_soccer_' + ev.id;
    const probs = comp.predictor || null;
    const hProb = probs && probs.homeTeam ? probs.homeTeam.gameProjection : null;
    const aProb = probs && probs.awayTeam ? probs.awayTeam.gameProjection : null;
    const venue = comp.venue && comp.venue.fullName ? comp.venue.fullName : '';

    await db.query(
      'INSERT INTO matches (league_id,home_team_id,away_team_id,match_date,status,venue,external_id,home_win_prob,away_win_prob,draw_prob) VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),home_win_prob=VALUES(home_win_prob),away_win_prob=VALUES(away_win_prob)',
      [lgId, hId, aId, dt, st, venue, ext, hProb, aProb, null]
    );
    const rows = await db.query('SELECT id FROM matches WHERE external_id=?', [ext]);
    const m = rows[0];

    if (st === 'completed') {
      const hs  = parseInt(home.score) || 0;
      const as_ = parseInt(away.score) || 0;
      const wId = hs > as_ ? hId : as_ > hs ? aId : null;
      await db.query(
        'INSERT INTO results (match_id,home_score,away_score,winner_team_id) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE home_score=VALUES(home_score),away_score=VALUES(away_score),winner_team_id=VALUES(winner_team_id)',
        [m.id, hs, as_, wId]
      );
    }
    n++;
  }
  return n;
}

async function syncFootball() {
  let total = 0;

  for (let i = 0; i < ESPN_LEAGUES.length; i++) {
    const lg = ESPN_LEAGUES[i];
    try {
      const n = await syncESPN(lg);
      total += n;
      log.info('[football] ESPN ' + lg.name + ': ' + n);
    } catch(e) {
      log.warn('[football] ESPN ' + lg.name + ' failed:', e.message);
    }
  }

  if (process.env.FOOTBALL_DATA_API_KEY) {
    try {
      const now = Date.now();
      const d1  = new Date(now - 14*86400000).toISOString().slice(0,10);
      const d2  = new Date(now + 14*86400000).toISOString().slice(0,10);
      const url = FD_BASE + '/matches?dateFrom=' + d1 + '&dateTo=' + d2;

      const data = await get(url, { headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY } });
      const matches = data.matches || [];

      for (let i = 0; i < matches.length; i++) {
        const m      = matches[i];
        const mapped  = FD_LEAGUE_MAP[m.competition.id];
        const lgName  = mapped ? mapped.name    : m.competition.name;
        const lgExtId = mapped ? mapped.extId   : 'fd_' + m.competition.id;
        const lgCntry = mapped ? mapped.country : m.area.name;
        const lgId    = await upsertLeague(lgName, lgCntry, 'football', lgExtId);

        const hId = await upsertTeam(m.homeTeam.name, m.homeTeam.shortName||m.homeTeam.tla||'', lgId, 'fd_t_'+m.homeTeam.id, '');
        const aId = await upsertTeam(m.awayTeam.name, m.awayTeam.shortName||m.awayTeam.tla||'', lgId, 'fd_t_'+m.awayTeam.id, '');

        const st  = m.status === 'FINISHED' ? 'completed' : (m.status === 'IN_PLAY' || m.status === 'PAUSED') ? 'live' : 'scheduled';
        const dt  = m.utcDate.replace('T',' ').replace('Z','');
        const ext = 'fd_m_' + m.id;

        await db.query(
          'INSERT INTO matches (league_id,home_team_id,away_team_id,match_date,status,venue,external_id) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),match_date=VALUES(match_date)',
          [lgId, hId, aId, dt, st, m.venue||'', ext]
        );
        const rows2 = await db.query('SELECT id FROM matches WHERE external_id=?', [ext]);
        const match = rows2[0];

        if (st === 'completed' && m.score && m.score.fullTime) {
          const h = m.score.fullTime.home || 0;
          const a = m.score.fullTime.away || 0;
          await db.query(
            'INSERT INTO results (match_id,home_score,away_score,winner_team_id) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE home_score=VALUES(home_score),away_score=VALUES(away_score),winner_team_id=VALUES(winner_team_id)',
            [match.id, h, a, h > a ? hId : a > h ? aId : null]
          );
        }
        total++;
      }
      log.info('[football] fd.org synced additional matches');
    } catch(e) {
      log.warn('[football] fd.org failed:', e.message);
    }
  }

  cache.invalidate('scores:');
  cache.invalidate('upcoming:');
  ws.emitScoresUpdate({ synced:total, source:'football' });
  return total;
}

module.exports = { syncFootball };
