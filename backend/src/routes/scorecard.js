/**
 * Scorecard Route  — /api/scorecard/:sport/:externalId
 *
 * Fetches rich live scorecard data directly from upstream APIs on demand.
 * Results are cached for 60 s to avoid hammering free tiers.
 *
 * GET /api/scorecard/nba/:espnEventId
 * GET /api/scorecard/nhl/:nhlGameId
 * GET /api/scorecard/soccer/:espnEventId?league=epl|ucl
 * GET /api/scorecard/cricket/:cricApiMatchId
 */

const router = require('express').Router();
const axios  = require('axios');
const cache  = require('../cache');
const log    = require('../utils/logger');

const SC_TTL = 60_000; // 60 s

async function get(url, cfg = {}) {
  const { data } = await axios.get(url, { timeout: 12_000, ...cfg });
  return data;
}

/* ── NBA ── */
router.get('/nba/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const ck = `sc:nba:${id}`;
    const hit = cache.get(ck);
    if (hit) return res.json({ success: true, data: hit, fromCache: true });

    const d = await get(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${id}`
    );

    // Quarter scores
    const teams = d.boxscore?.teams || [];
    const quarters = teams.map(t => ({
      team:       t.team?.abbreviation || '',
      logo:       t.team?.logo || '',
      linescores: (t.linescores || []).map(l => l.displayValue),
      total:      (t.linescores || []).reduce((s, l) => s + (parseInt(l.displayValue) || 0), 0),
    }));

    // Player box scores
    const players = teams.map(t => ({
      team: t.team?.displayName || '',
      abbr: t.team?.abbreviation || '',
      athletes: (t.athletes || []).map(a => ({
        name:     a.athlete?.displayName || '',
        starter:  !!a.starter,
        dnp:      !!a.didNotPlay,
        stats: {
          min: a.stats?.[0]  || '-',
          fgm: a.stats?.[1]  || '-',
          threepm: a.stats?.[3]  || '-',
          ftm: a.stats?.[5]  || '-',
          oreb: a.stats?.[7]  || '-',
          reb: a.stats?.[9]  || '-',
          ast: a.stats?.[10] || '-',
          stl: a.stats?.[11] || '-',
          blk: a.stats?.[12] || '-',
          to:  a.stats?.[13] || '-',
          pf:  a.stats?.[14] || '-',
          pts: a.stats?.[15] || '-',
          pm:  a.stats?.[16] || '-',
        },
      })),
    }));

    // Team stats (possession, rebounds, etc.)
    const teamStats = teams.map(t => {
      const find = key => t.statistics?.find(s => s.name === key)?.displayValue || '-';
      return {
        team: t.team?.abbreviation || '',
        stats: {
          fgPct:     find('fieldGoalPct'),
          threePct:  find('threePointFieldGoalPct'),
          ftPct:     find('freeThrowPct'),
          reb:       find('totalRebounds'),
          ast:       find('assists'),
          to:        find('turnovers'),
          stl:       find('steals'),
          blk:       find('blocks'),
          pts:       find('points'),
        },
      };
    });

    // Play by play — last 40 plays, reversed (most recent first)
    const plays = (d.plays || [])
      .filter(p => p.text)
      .slice(-40)
      .reverse()
      .map(p => ({
        period:    p.period?.number || 0,
        clock:     p.clock?.displayValue || '',
        text:      p.text,
        homeScore: p.homeScore,
        awayScore: p.awayScore,
        scoreValue: p.scoreValue || 0,
        isScoring: !!p.scoringPlay,
      }));

    // Leaders
    const leaders = (d.leaders || []).map(cat => ({
      category:    cat.displayName,
      leaders: (cat.leaders || []).slice(0, 3).map(l => ({
        name:        l.athlete?.displayName || '',
        displayVal:  l.displayValue,
        team:        l.team?.abbreviation || '',
      })),
    }));

    const payload = { quarters, players, teamStats, plays, leaders };
    cache.set(ck, payload);
    res.json({ success: true, data: payload });
  } catch (err) {
    log.error('[scorecard/nba]', err.message);
    next(err);
  }
});

/* ── NHL ── */
router.get('/nhl/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const ck = `sc:nhl:${id}`;
    const hit = cache.get(ck);
    if (hit) return res.json({ success: true, data: hit, fromCache: true });

    const [box, pbp] = await Promise.allSettled([
      get(`https://api-web.nhle.com/v1/gamecenter/${id}/boxscore`),
      get(`https://api-web.nhle.com/v1/gamecenter/${id}/play-by-play`),
    ]);

    const b = box.value || {};
    const p = pbp.value || {};

    // Period scores
    const periods = (b.linescore?.byPeriod || []).map((per, i) => ({
      label:  i < 3 ? `P${i + 1}` : 'OT',
      home:   per.home ?? '-',
      away:   per.away ?? '-',
    }));

    // Skater stats
    const buildSkaters = (side) => {
      const team    = b[side] || {};
      const ps      = b.playerByGameStats?.[side] || {};
      const skaters = [...(ps.forwards || []), ...(ps.defensemen || [])];
      const goalies = ps.goalies || [];
      return {
        team:    team.name?.default || team.abbrev || side,
        abbrev:  team.abbrev || '',
        logo:    team.logo || '',
        score:   team.score ?? 0,
        skaters: skaters.map(s => ({
          name:         s.name?.default || '',
          number:       s.sweaterNumber || '',
          position:     s.position || '',
          goals:        s.goals ?? 0,
          assists:      s.assists ?? 0,
          points:       s.points ?? 0,
          plusMinus:    s.plusMinus ?? 0,
          pim:          s.pim ?? 0,
          shots:        s.shots ?? 0,
          hits:         s.hits ?? 0,
          blocked:      s.blockedShots ?? 0,
          toi:          s.timeOnIce || '-',
          powerPlayGoals: s.powerPlayGoals ?? 0,
          shortHandedGoals: s.shortHandedGoals ?? 0,
        })),
        goalies: goalies.map(g => ({
          name:         g.name?.default || '',
          number:       g.sweaterNumber || '',
          shotsAgainst: g.shotsAgainst ?? 0,
          saves:        g.saves ?? 0,
          goalsAgainst: g.goalsAgainst ?? 0,
          savePct:      g.savePctg != null ? (g.savePctg * 100).toFixed(1) : '-',
          toi:          g.timeOnIce || '-',
          decision:     g.decision || '',
        })),
      };
    };

    const home = buildSkaters('homeTeam');
    const away = buildSkaters('awayTeam');

    // Goals from play-by-play
    const goals = (p.plays || [])
      .filter(g => g.typeDescKey === 'goal')
      .map(g => ({
        period:    g.periodDescriptor?.number || 0,
        time:      g.timeInPeriod || '',
        homeScore: g.details?.homeScore ?? 0,
        awayScore: g.details?.awayScore ?? 0,
        scorer:    g.details?.scoringPlayerName || 'Unknown',
        assist1:   g.details?.assist1PlayerName || null,
        assist2:   g.details?.assist2PlayerName || null,
        isHome:    g.details?.eventOwnerTeamId === b.homeTeam?.id,
        type:      g.details?.shotType || 'Goal',
        strength:  g.situationCode || '',
      }));

    // Penalties
    const penalties = (p.plays || [])
      .filter(g => g.typeDescKey === 'penalty')
      .map(g => ({
        period:   g.periodDescriptor?.number || 0,
        time:     g.timeInPeriod || '',
        player:   g.details?.committedByPlayerName || '',
        type:     g.details?.descKey || '',
        minutes:  g.details?.duration || '',
        isHome:   g.details?.eventOwnerTeamId === b.homeTeam?.id,
      }));

    // Shots on goal by period
    const shotsByPeriod = (b.linescore?.byPeriod || []).map((per, i) => ({
      period: i < 3 ? `P${i + 1}` : 'OT',
      home:   per.homeShots ?? '-',
      away:   per.awayShots ?? '-',
    }));

    const payload = { periods, home, away, goals, penalties, shotsByPeriod };
    cache.set(ck, payload);
    res.json({ success: true, data: payload });
  } catch (err) {
    log.error('[scorecard/nhl]', err.message);
    next(err);
  }
});

/* ── Soccer (EPL / UCL) ── */
router.get('/soccer/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { league = 'epl' } = req.query;
    const ck = `sc:soccer:${league}:${id}`;
    const hit = cache.get(ck);
    if (hit) return res.json({ success: true, data: hit, fromCache: true });

    const slug = league === 'ucl' ? 'UEFA.CHAMPIONS' : 'eng.1';
    const d    = await get(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${id}`
    );

    // Match stats (possession, shots, etc.)
    const teamStats = (d.boxscore?.teams || []).map(t => {
      const find = key => {
        const s = t.statistics?.find(x => x.name === key);
        return { display: s?.displayValue || '-', value: parseFloat(s?.value) || 0 };
      };
      return {
        team:   t.team?.displayName || '',
        abbrev: t.team?.abbreviation || '',
        logo:   t.team?.logo || '',
        stats: {
          possession:     find('possessionPct'),
          shots:          find('totalShots'),
          shotsOnTarget:  find('shotsOnTarget'),
          corners:        find('cornerKicks'),
          fouls:          find('fouls'),
          yellowCards:    find('yellowCards'),
          redCards:       find('redCards'),
          offsides:       find('offsides'),
          saves:          find('saves'),
          passes:         find('totalPasses'),
          passAccuracy:   find('passingAccuracy'),
          xg:             find('expectedGoals'),
        },
      };
    });

    // Timeline: goals, cards, substitutions
    const timeline = (d.plays || [])
      .filter(p => p.text)
      .map(p => ({
        minute:     p.clock?.displayValue || '',
        text:       p.text,
        homeScore:  p.homeScore ?? null,
        awayScore:  p.awayScore ?? null,
        isGoal:     !!p.scoringPlay,
        isYellow:   p.text.toLowerCase().includes('yellow'),
        isRed:      p.text.toLowerCase().includes('red card'),
        isSub:      p.text.toLowerCase().includes('substitut'),
        team:       p.team?.displayName || '',
      }));

    // Lineups / starters
    const lineups = (d.rosters || []).map(r => ({
      team:     r.team?.displayName || '',
      abbrev:   r.team?.abbreviation || '',
      logo:     r.team?.logo || '',
      starters: (r.roster || []).filter(p => p.starter).map(p => ({
        name:     p.athlete?.displayName || '',
        jersey:   p.jersey || '',
        position: p.position?.abbreviation || '',
      })),
      bench: (r.roster || []).filter(p => !p.starter).map(p => ({
        name:     p.athlete?.displayName || '',
        jersey:   p.jersey || '',
        position: p.position?.abbreviation || '',
      })),
    }));

    // Notes / aggregate
    const comp   = d.header?.competitions?.[0] || {};
    const notes  = comp.notes?.map(n => n.headline).join(' · ') || null;
    const format = comp.format?.regulation || null;

    const payload = { teamStats, timeline, lineups, notes, format };
    cache.set(ck, payload);
    res.json({ success: true, data: payload });
  } catch (err) {
    log.error('[scorecard/soccer]', err.message);
    next(err);
  }
});

/* ── Soccer via football-data.org (for fd_m_ matches) ── */
router.get('/soccer-fd/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const apiKey = process.env.FOOTBALL_DATA_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ success: false, error: 'FOOTBALL_DATA_API_KEY not configured.' });
    }
    const ck = `sc:soccer-fd:${id}`;
    const hit = cache.get(ck);
    if (hit) return res.json({ success: true, data: hit, fromCache: true });

    const d = await get(`https://api.football-data.org/v4/matches/${id}`, {
      headers: { 'X-Auth-Token': apiKey }
    });

    const timeline = [];
    for (const g of (d.goals || [])) {
      timeline.push({
        minute: g.minute ? String(g.minute) + (g.injuryTime ? '+' + g.injuryTime : '') : '',
        text: `${g.scorer?.name || 'Unknown'} (${g.team?.name || ''})${g.assist ? ' · assist: ' + g.assist.name : ''}`,
        homeScore: null, awayScore: null,
        isGoal: true, isYellow: false, isRed: false, isSub: false,
      });
    }
    for (const b of (d.bookings || [])) {
      timeline.push({
        minute: b.minute ? String(b.minute) : '',
        text: `${b.player?.name || 'Unknown'} (${b.team?.name || ''})`,
        homeScore: null, awayScore: null,
        isGoal: false,
        isYellow: b.card === 'YELLOW_CARD',
        isRed: b.card === 'RED_CARD' || b.card === 'YELLOW_RED_CARD',
        isSub: false,
      });
    }
    timeline.sort((a, b) => (parseInt(a.minute) || 0) - (parseInt(b.minute) || 0));

    const lineups = (d.lineups || []).map(l => ({
      team: l.team?.name || '',
      abbrev: l.team?.shortName || '',
      logo: '',
      starters: (l.lineup || []).map(p => ({ name: p.name || '', jersey: p.shirtNumber || '', position: p.position || '' })),
      bench: (l.bench || []).map(p => ({ name: p.name || '', jersey: p.shirtNumber || '', position: p.position || '' })),
    }));

    const teamStats = [
      { team: d.homeTeam?.name || 'Home', abbrev: d.homeTeam?.shortName || '', logo: '', stats: {} },
      { team: d.awayTeam?.name || 'Away', abbrev: d.awayTeam?.shortName || '', logo: '', stats: {} },
    ];

    const notes = d.competition?.name ? `${d.competition.name} · Matchday ${d.matchday || ''}` : null;
    const payload = { teamStats, timeline, lineups, notes };
    cache.set(ck, payload);
    res.json({ success: true, data: payload });
  } catch (err) {
    log.error('[scorecard/soccer-fd]', err.message);
    next(err);
  }
});

/* ── Cricket ── */
router.get('/cricket/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const apiKey = process.env.CRICAPI_KEY;
    if (!apiKey) {
      return res.status(503).json({
        success: false,
        error:   'CRICAPI_KEY not configured. Add it to your .env file.',
        signup:  'https://cricapi.com/register',
      });
    }

    const ck = `sc:cricket:${id}`;
    const hit = cache.get(ck);
    if (hit) return res.json({ success: true, data: hit, fromCache: true });

    const d = await get(`https://api.cricapi.com/v1/match_scorecard?apikey=${apiKey}&id=${id}`);
    if (d.status !== 'success') {
      return res.status(502).json({ success: false, error: d.message || 'CricAPI error', raw: d });
    }

    const m = d.data;
    const innings = (m.scorecard || []).map(inn => {
      const total = inn.total || {};
      const overs = parseFloat(total.overs) || 0;
      const runs  = parseInt(total.r) || 0;
      const rr    = overs > 0 ? (runs / overs).toFixed(2) : '-';

      const batting = (inn.batting || []).map(b => ({
        name:        b.batsman?.name || '',
        dismissal:   b['out-by'] || (b.r !== undefined ? 'not out' : ''),
        runs:        b.r ?? '-',
        balls:       b.b ?? '-',
        fours:       b.fours ?? '-',
        sixes:       b.sixes ?? '-',
        strikeRate:  b.sr || '-',
        isNotOut:    !b['out-by'],
      }));

      const bowling = (inn.bowling || []).map(b => ({
        name:      b.bowler?.name || '',
        overs:     b.o ?? '-',
        maidens:   b.m ?? '-',
        runs:      b.r ?? '-',
        wickets:   b.w ?? '-',
        economy:   b.eco || '-',
        wides:     b.wd ?? '-',
        noBalls:   b.nb ?? '-',
      }));

      const extras = inn.extras || {};
      const fow    = (inn.fow || []).map(f => ({
        wicket: f.wkt,
        score:  f.r,
        batter: f.name,
        overs:  f.ov,
      }));

      return {
        name:    inn.inning || '',
        total:   { runs, wickets: total.wkts ?? '-', overs: total.overs || '-', rr },
        extras:  {
          total: extras.r ?? 0,
          byes:  extras.b ?? 0,
          legByes: extras.lb ?? 0,
          wides: extras.wd ?? 0,
          noBalls: extras.nb ?? 0,
          penalty: extras.pen ?? 0,
        },
        batting, bowling, fow,
      };
    });

    const payload = {
      name:    m.name || '',
      status:  m.status || '',
      venue:   m.venue || '',
      date:    m.date || '',
      teams:   m.teams || [],
      matchType: m.matchType || '',
      innings,
    };

    cache.set(ck, payload);
    res.json({ success: true, data: payload });
  } catch (err) {
    log.error('[scorecard/cricket]', err.message);
    next(err);
  }
});

module.exports = router;
