-- ═══════════════════════════════════════════════════════════
--  Velocity Pro — Live Sports Dashboard
--  Normalized MySQL / PostgreSQL Schema  (v4.0.2)
--  Run: mysql -u root -p sports_dashboard < schema.sql
-- ═══════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS sports_dashboard
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE sports_dashboard;

-- ───────────────────────────────────────────────────────────
--  TABLE: leagues
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leagues (
  id          INT          NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  country     VARCHAR(50)  NOT NULL DEFAULT '',
  sport       VARCHAR(50)  NOT NULL DEFAULT 'football',  -- football | basketball | cricket | hockey | american_football
  external_id VARCHAR(50)  NULL UNIQUE,                   -- ID from external API
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- ───────────────────────────────────────────────────────────
--  TABLE: teams
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id          INT          NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  short_name  VARCHAR(10)  NOT NULL DEFAULT '',
  league_id   INT          NOT NULL,
  logo_url    TEXT         NULL,
  external_id VARCHAR(100) NULL UNIQUE,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ───────────────────────────────────────────────────────────
--  TABLE: matches
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matches (
  id            INT          NOT NULL AUTO_INCREMENT,
  league_id     INT          NOT NULL,
  home_team_id  INT          NOT NULL,
  away_team_id  INT          NOT NULL,
  match_date    DATETIME     NOT NULL,
  status        VARCHAR(50)  NOT NULL DEFAULT 'scheduled', -- scheduled | live | completed
  venue         VARCHAR(100) NOT NULL DEFAULT '',
  home_win_prob FLOAT        NULL,
  away_win_prob FLOAT        NULL,
  draw_prob     FLOAT        NULL,
  external_id   VARCHAR(100) NULL UNIQUE,                  -- prevents duplicates on re-sync
  external_meta JSON         NULL,                          -- sport-specific rich data (innings, OT suffix, notes…)
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  FOREIGN KEY (league_id)    REFERENCES leagues(id) ON DELETE CASCADE,
  FOREIGN KEY (home_team_id) REFERENCES teams(id)   ON DELETE CASCADE,
  FOREIGN KEY (away_team_id) REFERENCES teams(id)   ON DELETE CASCADE,
  INDEX idx_status      (status),
  INDEX idx_match_date  (match_date),
  INDEX idx_league_date (league_id, match_date)
) ENGINE=InnoDB;

-- ───────────────────────────────────────────────────────────
--  TABLE: results
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS results (
  id              INT       NOT NULL AUTO_INCREMENT,
  match_id        INT       NOT NULL UNIQUE,   -- 1-to-1 with matches
  home_score      INT       NOT NULL DEFAULT 0,
  away_score      INT       NOT NULL DEFAULT 0,
  winner_team_id  INT       NULL,              -- NULL = draw
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  FOREIGN KEY (match_id)       REFERENCES matches(id) ON DELETE CASCADE,
  FOREIGN KEY (winner_team_id) REFERENCES teams(id)   ON DELETE SET NULL
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
--  SAMPLE DATA
-- ═══════════════════════════════════════════════════════════

-- Leagues
INSERT INTO leagues (name, country, sport, external_id) VALUES
  ('NBA',                   'USA',     'basketball',       'nba'),
  ('Premier League',        'England', 'football',         'pl'),
  ('UEFA Champions League', 'Europe',  'football',         'ucl'),
  ('IPL',                   'India',   'cricket',          'ipl'),
  ('NHL',                   'USA',     'hockey',           'nhl'),
  ('NFL',                   'USA',     'american_football','nfl')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Teams — NBA
INSERT INTO teams (name, short_name, league_id, external_id)
SELECT 'Los Angeles Lakers','LAL', l.id, 'lakers'
FROM   leagues l WHERE l.external_id = 'nba'
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO teams (name, short_name, league_id, external_id)
SELECT 'Golden State Warriors','GSW', l.id, 'warriors'
FROM   leagues l WHERE l.external_id = 'nba'
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO teams (name, short_name, league_id, external_id)
SELECT 'Phoenix Suns','PHX', l.id, 'suns'
FROM   leagues l WHERE l.external_id = 'nba'
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO teams (name, short_name, league_id, external_id)
SELECT 'Oklahoma City Thunder','OKC', l.id, 'thunder'
FROM   leagues l WHERE l.external_id = 'nba'
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO teams (name, short_name, league_id, external_id)
SELECT 'Boston Celtics','BOS', l.id, 'celtics'
FROM   leagues l WHERE l.external_id = 'nba'
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO teams (name, short_name, league_id, external_id)
SELECT 'Miami Heat','MIA', l.id, 'heat'
FROM   leagues l WHERE l.external_id = 'nba'
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Teams — EPL
INSERT INTO teams (name, short_name, league_id, external_id)
SELECT 'Manchester City','MCFC', l.id, 'mancity'
FROM   leagues l WHERE l.external_id = 'pl'
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO teams (name, short_name, league_id, external_id)
SELECT 'Arsenal','ARS', l.id, 'arsenal'
FROM   leagues l WHERE l.external_id = 'pl'
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO teams (name, short_name, league_id, external_id)
SELECT 'Liverpool','LIV', l.id, 'liverpool'
FROM   leagues l WHERE l.external_id = 'pl'
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO teams (name, short_name, league_id, external_id)
SELECT 'Chelsea','CHE', l.id, 'chelsea'
FROM   leagues l WHERE l.external_id = 'pl'
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Teams — UCL
INSERT INTO teams (name, short_name, league_id, external_id)
SELECT 'Real Madrid','RMA', l.id, 'realmadrid'
FROM   leagues l WHERE l.external_id = 'ucl'
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO teams (name, short_name, league_id, external_id)
SELECT 'FC Barcelona','BAR', l.id, 'barcelona'
FROM   leagues l WHERE l.external_id = 'ucl'
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO teams (name, short_name, league_id, external_id)
SELECT 'Paris Saint-Germain','PSG', l.id, 'psg'
FROM   leagues l WHERE l.external_id = 'ucl'
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO teams (name, short_name, league_id, external_id)
SELECT 'Bayern Munich','BAY', l.id, 'bayernmunich'
FROM   leagues l WHERE l.external_id = 'ucl'
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Teams — IPL
INSERT INTO teams (name, short_name, league_id, external_id)
SELECT 'Mumbai Indians','MI', l.id, 'mi'
FROM   leagues l WHERE l.external_id = 'ipl'
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO teams (name, short_name, league_id, external_id)
SELECT 'Chennai Super Kings','CSK', l.id, 'csk'
FROM   leagues l WHERE l.external_id = 'ipl'
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO teams (name, short_name, league_id, external_id)
SELECT 'Royal Challengers Bengaluru','RCB', l.id, 'rcb'
FROM   leagues l WHERE l.external_id = 'ipl'
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO teams (name, short_name, league_id, external_id)
SELECT 'Kolkata Knight Riders','KKR', l.id, 'kkr'
FROM   leagues l WHERE l.external_id = 'ipl'
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Teams — NHL
INSERT INTO teams (name, short_name, league_id, external_id)
SELECT 'Boston Bruins','BOS', l.id, 'bruins'
FROM   leagues l WHERE l.external_id = 'nhl'
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO teams (name, short_name, league_id, external_id)
SELECT 'New York Rangers','NYR', l.id, 'rangers'
FROM   leagues l WHERE l.external_id = 'nhl'
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ── Sample matches (completed) ──────────────────────────────

-- NBA: Lakers 118 – 112 Warriors
INSERT INTO matches
  (league_id, home_team_id, away_team_id, match_date, status, venue, external_id)
SELECT
  (SELECT id FROM leagues WHERE external_id='nba'),
  (SELECT id FROM teams   WHERE external_id='lakers'),
  (SELECT id FROM teams   WHERE external_id='warriors'),
  DATE_SUB(NOW(), INTERVAL 2 DAY), 'completed', 'Crypto.com Arena', 'match_nba_001'
ON DUPLICATE KEY UPDATE status='completed';

INSERT INTO results (match_id, home_score, away_score, winner_team_id)
SELECT m.id, 118, 112, (SELECT id FROM teams WHERE external_id='lakers')
FROM   matches m WHERE m.external_id = 'match_nba_001'
ON DUPLICATE KEY UPDATE home_score=118, away_score=112;

-- EPL: Man City 3 – 1 Arsenal
INSERT INTO matches
  (league_id, home_team_id, away_team_id, match_date, status, venue, external_id)
SELECT
  (SELECT id FROM leagues WHERE external_id='pl'),
  (SELECT id FROM teams   WHERE external_id='mancity'),
  (SELECT id FROM teams   WHERE external_id='arsenal'),
  DATE_SUB(NOW(), INTERVAL 3 DAY), 'completed', 'Etihad Stadium', 'match_pl_001'
ON DUPLICATE KEY UPDATE status='completed';

INSERT INTO results (match_id, home_score, away_score, winner_team_id)
SELECT m.id, 3, 1, (SELECT id FROM teams WHERE external_id='mancity')
FROM   matches m WHERE m.external_id = 'match_pl_001'
ON DUPLICATE KEY UPDATE home_score=3, away_score=1;

-- UCL: PSG 2 – 3 Bayern
INSERT INTO matches
  (league_id, home_team_id, away_team_id, match_date, status, venue, external_id)
SELECT
  (SELECT id FROM leagues WHERE external_id='ucl'),
  (SELECT id FROM teams   WHERE external_id='psg'),
  (SELECT id FROM teams   WHERE external_id='bayernmunich'),
  DATE_SUB(NOW(), INTERVAL 4 DAY), 'completed', 'Parc des Princes', 'match_ucl_001'
ON DUPLICATE KEY UPDATE status='completed';

INSERT INTO results (match_id, home_score, away_score, winner_team_id)
SELECT m.id, 2, 3, (SELECT id FROM teams WHERE external_id='bayernmunich')
FROM   matches m WHERE m.external_id = 'match_ucl_001'
ON DUPLICATE KEY UPDATE home_score=2, away_score=3;

-- IPL: MI 187 – 165 CSK
INSERT INTO matches
  (league_id, home_team_id, away_team_id, match_date, status, venue, external_id)
SELECT
  (SELECT id FROM leagues WHERE external_id='ipl'),
  (SELECT id FROM teams   WHERE external_id='mi'),
  (SELECT id FROM teams   WHERE external_id='csk'),
  DATE_SUB(NOW(), INTERVAL 1 DAY), 'completed', 'Wankhede Stadium', 'match_ipl_001'
ON DUPLICATE KEY UPDATE status='completed';

INSERT INTO results (match_id, home_score, away_score, winner_team_id)
SELECT m.id, 187, 165, (SELECT id FROM teams WHERE external_id='mi')
FROM   matches m WHERE m.external_id = 'match_ipl_001'
ON DUPLICATE KEY UPDATE home_score=187, away_score=165;

-- ── Sample matches (upcoming / scheduled) ──────────────────

-- UCL: Real Madrid vs Barcelona
INSERT INTO matches
  (league_id, home_team_id, away_team_id, match_date, status, venue, home_win_prob, away_win_prob, draw_prob, external_id)
SELECT
  (SELECT id FROM leagues WHERE external_id='ucl'),
  (SELECT id FROM teams   WHERE external_id='realmadrid'),
  (SELECT id FROM teams   WHERE external_id='barcelona'),
  DATE_ADD(NOW(), INTERVAL 1 DAY), 'scheduled', 'Santiago Bernabéu', 0.45, 0.33, 0.22, 'match_ucl_002'
ON DUPLICATE KEY UPDATE status='scheduled';

-- NBA: Celtics vs Heat
INSERT INTO matches
  (league_id, home_team_id, away_team_id, match_date, status, venue, home_win_prob, away_win_prob, draw_prob, external_id)
SELECT
  (SELECT id FROM leagues WHERE external_id='nba'),
  (SELECT id FROM teams   WHERE external_id='celtics'),
  (SELECT id FROM teams   WHERE external_id='heat'),
  DATE_ADD(NOW(), INTERVAL 2 DAY), 'scheduled', 'TD Garden', 0.68, 0.32, 0.00, 'match_nba_002'
ON DUPLICATE KEY UPDATE status='scheduled';

-- IPL: RCB vs KKR
INSERT INTO matches
  (league_id, home_team_id, away_team_id, match_date, status, venue, home_win_prob, away_win_prob, draw_prob, external_id)
SELECT
  (SELECT id FROM leagues WHERE external_id='ipl'),
  (SELECT id FROM teams   WHERE external_id='rcb'),
  (SELECT id FROM teams   WHERE external_id='kkr'),
  DATE_ADD(NOW(), INTERVAL 3 DAY), 'scheduled', 'M. Chinnaswamy Stadium', 0.43, 0.57, 0.00, 'match_ipl_002'
ON DUPLICATE KEY UPDATE status='scheduled';

-- ═══════════════════════════════════════════════════════════
--  EXAMPLE QUERIES (for reference / SQL Schema tab)
-- ═══════════════════════════════════════════════════════════

/*
-- 1) Results by league
SELECT m.id,
  l.name AS league, ht.name AS home_team, at.name AS away_team,
  r.home_score, r.away_score, wt.name AS winner
FROM matches m
JOIN  leagues l  ON m.league_id    = l.id
JOIN  teams   ht ON m.home_team_id = ht.id
JOIN  teams   at ON m.away_team_id = at.id
LEFT JOIN results r  ON m.id           = r.match_id
LEFT JOIN teams  wt  ON r.winner_team_id = wt.id
WHERE l.name = 'NBA'
ORDER BY m.match_date DESC;

-- 2) Highest scoring matches
SELECT m.id, ht.name AS home_team, at.name AS away_team,
  r.home_score, r.away_score,
  (r.home_score + r.away_score) AS total_score
FROM matches m
JOIN teams  ht ON m.home_team_id = ht.id
JOIN teams  at ON m.away_team_id = at.id
JOIN results r ON m.id           = r.match_id
ORDER BY total_score DESC LIMIT 10;

-- 3) Team win performance
SELECT t.name AS team, l.name AS league,
  COUNT(*) AS total_wins,
  ROUND(COUNT(*) * 100.0 /
    NULLIF((SELECT COUNT(*) FROM matches m2
            WHERE m2.home_team_id = t.id OR m2.away_team_id = t.id), 0), 1
  ) AS win_rate_pct
FROM results r
JOIN teams   t ON r.winner_team_id = t.id
JOIN matches m ON r.match_id       = m.id
JOIN leagues l ON m.league_id      = l.id
GROUP BY t.id, t.name, l.name
ORDER BY total_wins DESC;

-- 4) Upcoming fixtures
SELECT m.id, l.name AS league, ht.name AS home_team, at.name AS away_team,
  m.match_date, m.venue, m.home_win_prob, m.away_win_prob, m.draw_prob
FROM matches m
JOIN leagues l  ON m.league_id    = l.id
JOIN teams   ht ON m.home_team_id = ht.id
JOIN teams   at ON m.away_team_id = at.id
WHERE m.status = 'scheduled' AND m.match_date > NOW()
ORDER BY m.match_date ASC;
*/
