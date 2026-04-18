// PM2 ecosystem config
// Usage:
//   pm2 start ecosystem.config.js            (production)
//   pm2 start ecosystem.config.js --env dev  (development)
//   pm2 save && pm2 startup                  (auto-restart on reboot)

module.exports = {
  apps: [
    {
      name:         'velocity-pro',
      script:       'server.js',
      cwd:          './backend',
      instances:    'max',        // one worker per CPU core
      exec_mode:    'cluster',    // Node.js cluster mode
      watch:        false,
      max_memory_restart: '500M',

      // Environment — production
      env: {
        NODE_ENV:  'production',
        PORT:      3001,
      },

      // Environment — development (pm2 start ... --env dev)
      env_dev: {
        NODE_ENV:  'development',
        PORT:      3001,
        watch:     true,
        ignore_watch: ['node_modules', 'logs'],
      },

      // Logging
      log_date_format:  'YYYY-MM-DD HH:mm:ss',
      out_file:  './logs/out.log',
      error_file:'./logs/error.log',
      merge_logs: true,

      // Zero-downtime restart
      kill_timeout:     5000,
      wait_ready:       false,
      listen_timeout:   10000,
    },
  ],
};
