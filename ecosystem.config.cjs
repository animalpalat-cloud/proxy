/**
 * PM2 process file — run from repo root: pm2 start ecosystem.config.cjs
 */
module.exports = {
  apps: [
    {
      name: "openrelay-bare",
      cwd: "./rust-server",
      script: "./run-release.sh",
      interpreter: "bash",
      instances: 1,
      exec_mode: "fork",
      env: {
        RUST_LOG: "info,openrelay_bare=debug",
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
        RUST_BARE_URL: "http://127.0.0.1:8000",
      },
      max_memory_restart: "1G",
    },
  ],
};
