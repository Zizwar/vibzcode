module.exports = {
  apps: [{
    name: 'vibzcode',
    script: 'server.js',
    cwd: '/root/wino/agyz',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3333
    }
  }]
};
