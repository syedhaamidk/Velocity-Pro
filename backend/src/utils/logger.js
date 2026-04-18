const ts = () => new Date().toISOString();

const log = {
  info:  (...a) => console.log (`[${ts()}] INFO `, ...a),
  warn:  (...a) => console.warn(`[${ts()}] WARN `, ...a),
  error: (...a) => console.error(`[${ts()}] ERROR`, ...a),
};

module.exports = log;
