#!/usr/bin/env node

/**
 * VibzCode CLI Runner
 * Sovereign Multi-Engine AI Agent Orchestrator & Workspace Platform
 *
 * Usage:
 *   npx vibzcode
 *   npx vibzcode --port 3333
 *   npx vibzcode --no-open
 *   npx vibzcode --status
 */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { loadEnv, checkKeysStatus } = require('../lib/envHelper');

// Load environment variables before doing anything
loadEnv();

const args = process.argv.slice(2);

// Handle help
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  \x1b[36m\x1b[1mVibzCode CLI\x1b[0m - Sovereign Multi-Engine AI Agent Orchestrator

  \x1b[1mUsage:\x1b[0m
    npx vibzcode [options]

  \x1b[1mOptions:\x1b[0m
    -p, --port <number>    Set server port (default: 3333 or $PORT)
    --host <string>        Set server host (default: 0.0.0.0)
    --no-open              Do not automatically open dashboard in browser
    --status               Check configuration and API keys status without starting server
    -v, --version          Show version
    -h, --help             Show this help message

  \x1b[1mDocumentation & GitHub:\x1b[0m
    https://github.com/Zizwar/vibzcode
  `);
  process.exit(0);
}

// Handle version
const pkg = require('../package.json');
if (args.includes('--version') || args.includes('-v')) {
  console.log(`v${pkg.version}`);
  process.exit(0);
}

// Parse port
let customPort = process.env.PORT || 3333;
const portIdx = args.findIndex(a => a === '--port' || a === '-p');
if (portIdx !== -1 && args[portIdx + 1]) {
  customPort = parseInt(args[portIdx + 1], 10) || customPort;
}
process.env.PORT = String(customPort);

// Check keys status
const status = checkKeysStatus();

// Print Banner
console.log(`
\x1b[36m\x1b[1m
  __     ___ _           ____          _      
  \\ \\   / (_) |__  ____ / ___|___   __| | ___ 
   \\ \\ / /| | '_ \\|_  /| |   / _ \\ / _\` |/ _ \\
    \\ V / | | |_) |/ / | |__| (_) | (_| |  __/
     \\_/  |_|_.__//___| \\____\\___/ \\__,_|\\___|
\x1b[0m  \x1b[90mv${pkg.version} | Sovereign Multi-Engine AI Orchestrator\x1b[0m
`);

// Print status table
console.log('\x1b[1m  System Configuration Status:\x1b[0m');
const printBadge = (ok, label, tip) => {
  const icon = ok ? '\x1b[32m✔ [Ready]\x1b[0m' : '\x1b[33m⚠️  [Missing]\x1b[0m';
  console.log(`    ${icon} ${label} ${ok ? '' : `\x1b[90m(${tip})\x1b[0m`}`);
};

printBadge(status.keys.gemini.configured, 'Google Gemini AI', 'Set GEMINI_API_KEY for skill distillation & fast LLM');
printBadge(status.keys.memoryz.configured, 'MemoryZ Substrate', 'Set MEMORYZ_TOKEN for shared memory & tasks');
printBadge(status.keys.jev.configured, 'TypeSafe Jev AI (Optional)', 'Set JEV_AI_KEY for System One evaluation');
printBadge(status.keys.adminPass.configured, 'Admin Password Security', 'Default pass in use. Update via .env or Web UI');

if (status.hasEnvFile) {
  console.log(`\n  \x1b[90m📁 Active Config File: ${status.envPath}\x1b[0m`);
} else {
  console.log(`\n  \x1b[33mℹ️  No .env file detected. A new one will be created when configuring keys.\x1b[0m`);
}

if (args.includes('--status')) {
  process.exit(0);
}

// Notice if keys missing
if (!status.isReady) {
  console.log(`\n  \x1b[35m\x1b[1m👉 Action Required:\x1b[0m API keys are not yet configured.`);
  console.log(`     The web interface will automatically guide you through the setup page.\n`);
}

const shouldOpen = !args.includes('--no-open');

// Start the server
const serverPath = path.join(__dirname, '..', 'server.js');
require(serverPath);

const url = `http://localhost:${customPort}`;
console.log(`  \x1b[32m\x1b[1m🚀 VibzCode is running at:\x1b[0m \x1b[4m\x1b[36m${url}\x1b[0m`);
console.log(`  \x1b[90mPress Ctrl+C to stop.\x1b[0m\n`);

// Auto-open browser
if (shouldOpen) {
  setTimeout(() => {
    const platform = process.platform;
    const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
    try {
      const child = spawn(cmd, [url], { stdio: 'ignore', detached: true });
      child.unref();
    } catch (_) {}
  }, 1000);
}
