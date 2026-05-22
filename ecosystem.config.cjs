/**
 * PM2 process file — run from repo root: pm2 start ecosystem.config.cjs
 */
module.exports = {
  apps: [
    {
      name: "openrelay-api",
      cwd: "./server",
      script: "src/index.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "512M",
    },
    {
      name: "openrelay-web",
      cwd: "./my-app",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "1G",
    },
  ],
};
