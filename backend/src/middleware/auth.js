const log = require('../utils/logger');

/**
 * Require X-API-Key header to match SYNC_API_KEY env var.
 * If no key is configured, allows through with a warning (dev mode).
 */
function requireApiKey(req, res, next) {
  if (!process.env.SYNC_API_KEY) {
    log.warn('[auth] SYNC_API_KEY not set — write endpoints are unprotected!');
    return next();
  }
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.SYNC_API_KEY) {
    return res.status(401).json({
      success: false,
      error:   'Unauthorized — invalid or missing X-API-Key header.',
    });
  }
  next();
}

module.exports = { requireApiKey };
