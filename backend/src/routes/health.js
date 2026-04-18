const router = require('express').Router();
const { getPool } = require('../db/pool');
const { clientCount } = require('../websocket/liveUpdates');
const { size } = require('../cache');

router.get('/', async (req, res) => {
  try {
    await getPool().execute('SELECT 1');
    res.json({
      status:     'ok',
      db:         'connected',
      wsClients:  clientCount(),
      cacheSize:  size(),
      ts:         new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected', error: err.message });
  }
});

module.exports = router;
