const mysql = require('mysql2/promise');
const log   = require('../utils/logger');

let pool;

function createPool() {
  pool = mysql.createPool({
    host:               process.env.DB_HOST     || 'localhost',
    port:               parseInt(process.env.DB_PORT || '3306'),
    user:               process.env.DB_USER     || 'root',
    password:           process.env.DB_PASSWORD || '',
    database:           process.env.DB_NAME     || 'sports_dashboard',
    waitForConnections: true,
    connectionLimit:    10,
    queueLimit:         0,
    enableKeepAlive:    true,
    keepAliveInitialDelay: 10_000,
  });
  pool.on('connection', () => log.info('[db] New pool connection established'));
  return pool;
}

createPool();

/**
 * Execute a SQL query with auto-reconnect on dropped connection.
 */
async function query(sql, params = []) {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (err) {
    if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
      log.warn('[db] Connection lost — recreating pool and retrying…');
      createPool();
      const [rows] = await pool.execute(sql, params);
      return rows;
    }
    throw err;
  }
}

async function end() {
  if (pool) await pool.end();
}

module.exports = { query, end, getPool: () => pool };
