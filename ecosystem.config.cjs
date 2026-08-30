/**
 * PM2 process manager — for VM deployments (a DigitalOcean Droplet, an EC2
 * instance) where there is no container orchestrator to restart a dead process.
 *
 *   npm ci --omit=dev && npm run build
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 save && pm2 startup     # survive a host reboot
 *
 * On a platform that already supervises the process (App Platform, ECS,
 * Kubernetes, Docker `restart: unless-stopped`), do NOT use this — two
 * supervisors fighting over one process makes failures harder to reason about.
 */
module.exports = {
  apps: [
    {
      name: 'nexusbet-api',
      script: 'server/src/server.js',

      // The lounge, the TTL cache and the fitted models are all in-process
      // memory. Forking more workers would give each its own chat room and its
      // own cache, so a user's WebSocket and their next HTTP request could land
      // on different states. Scaling out needs a shared bus first — see
      // DEPLOYMENT.md, "Scaling beyond one instance".
      instances: 1,
      exec_mode: 'fork',

      // Crash recovery.
      autorestart: true,
      max_restarts: 10,
      // Restarts inside this window count toward max_restarts; surviving longer
      // resets the counter, so a genuine crash loop stops instead of thrashing.
      min_uptime: '30s',
      restart_delay: 2000,
      exp_backoff_restart_delay: 200,

      // Restart if the process leaks past this. The fitted models and league
      // history caches are the largest resident objects.
      max_memory_restart: '512M',

      // Give in-flight requests and WebSocket closes time to drain on SIGTERM.
      kill_timeout: 10_000,
      listen_timeout: 10_000,
      wait_ready: false,

      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
        // Real secrets come from the environment or a .env file that PM2 loads
        // — never from this committed file.
      },

      // Let the platform's collector handle rotation; PM2 only timestamps.
      time: true,
      merge_logs: true,
      out_file: './logs/out.log',
      error_file: './logs/error.log',
    },
  ],
};
