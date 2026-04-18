const log = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  log.error(`[${req.method} ${req.url}]`, err.message);
  res.status(err.status || 500).json({
    success: false,
    error:   process.env.NODE_ENV === 'production'
               ? 'Internal server error'
               : err.message,
  });
}

module.exports = { errorHandler };
