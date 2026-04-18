const { Server } = require('socket.io');
const log        = require('../utils/logger');

let io;

function init(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin:  process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    log.info(`[ws] Client connected: ${socket.id}`);
    socket.emit('connected', {
      ts:  new Date().toISOString(),
      msg: 'Real-time updates active',
    });
    socket.on('disconnect', () =>
      log.info(`[ws] Client disconnected: ${socket.id}`)
    );
  });

  return io;
}

/**
 * Push a scores:update event to all connected clients.
 * Called by syncService after a successful sync.
 */
function emitScoresUpdate(payload) {
  if (!io) return;
  io.emit('scores:update', { ts: new Date().toISOString(), ...payload });
}

function clientCount() {
  return io ? io.engine.clientsCount : 0;
}

module.exports = { init, emitScoresUpdate, clientCount };
