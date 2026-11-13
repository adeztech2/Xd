module.exports = {
  apps: [
    {
      name: 'adez-md',
      script: 'index.js',
      instances: 1,            // never run two copies on the same SESSION_ID
      autorestart: true,
      max_memory_restart: '450M',
      restart_delay: 5000,
      env: { NODE_ENV: 'production' },
    },
  ],
};
