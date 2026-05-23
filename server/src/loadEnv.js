/**
 * Load server/.env before any other local module reads process.env.
 * Uses an explicit path so node --watch and varying cwd never miss the file.
 */
const path = require("node:path");
const dotenv = require("dotenv");

const envPath = path.resolve(__dirname, "..", ".env");

const result = dotenv.config({
  path: envPath,
  quiet: true,
  override: true,
});

if (result.error && result.error.code !== "ENOENT") {
  console.warn("[loadEnv] Failed to read .env:", result.error.message);
}

module.exports = { envPath, parsed: result.parsed || {} };
