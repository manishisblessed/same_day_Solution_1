// PM2 Configuration for EC2
// Use this with: pm2 start ec2.config.js

module.exports = {
  apps: [{
    name: 'same-day-solution',
    script: 'npm',
    args: 'start',
    cwd: '/home/ec2-user/same-day-solution', // Update this path
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    max_memory_restart: '1G',
  }]
}

