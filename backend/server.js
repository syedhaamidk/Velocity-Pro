require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const http    = require('http');

const log            = require('./src/utils/logger');
const db             = require('./src/db/pool');
const ws             = require('./src/websocket/liveUpdates');
const { globalLimiter } = require('./src/middleware/rateLimiter');
const { errorHandler }  = require('./src/middleware/errorHandler');

const { syncFootball } = require('./src/services/footballApi');
const { syncNBA }      = require('./src/services/nbaApi');
const { syncNHL }      = require('./src/services/nhlApi');
const { syncCricket }  = require('./src/services/cricketApi');

const healthRoute    = require('./src/routes/health');
const leaguesRoute   = require('./src/routes/leagues');
const scoresRoute    = require('./src/routes/scores');
const upcomingRoute  = require('./src/routes/upcoming');
const statsRoute     = require('./src/routes/stats');
const syncRoute      = require('./src/routes/sync');
const scorecardRoute = require('./src/routes/scorecard');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3001;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use(globalLimiter);
app.use((req, _res, next) => { log.info(`${req.method} ${req.url}`); next(); });

app.use('/api/health',     healthRoute);
app.use('/api/leagues',    leaguesRoute);
app.use('/api/scores',     scoresRoute);
app.use('/api/upcoming',   upcomingRoute);
app.use('/api/stats',      statsRoute);
app.use('/api/sync',       syncRoute);
app.use('/api/scorecard',  scorecardRoute);

// Serve frontend from /frontend if it exists (optional co-location)
const path = require('path');
const fs   = require('fs');
const frontendPath = path.join(__dirname, '..', 'frontend', 'index.html');
if (fs.existsSync(frontendPath)) {
  app.get('/', (_req, res) => res.sendFile(frontendPath));
}

app.use((req, res) => res.status(404).json({ success:false, error:`Route ${req.url} not found` }));
app.use(errorHandler);

ws.init(server);

// Sync all sports every 90 seconds
async function syncAll() {
  const fns = [
    ['football', syncFootball],
    ['nba',      syncNBA],
    ['nhl',      syncNHL],
    ['cricket',  syncCricket],
  ];
  for (const [name, fn] of fns) {
    try { await fn(); }
    catch (e) { log.error(`[auto-sync] ${name}:`, e.message); }
  }
}

server.listen(PORT, () => {
  log.info(`🚀 API ready   → http://localhost:${PORT}/api/health`);
  log.info(`🔌 WebSocket   → ws://localhost:${PORT}`);
  log.info(`📡 Syncing all sports on boot…`);
  syncAll();
  setInterval(syncAll, 90_000);
});

async function shutdown(sig) {
  log.info(`[shutdown] ${sig} — draining…`);
  server.close(async () => { await db.end(); process.exit(0); });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
