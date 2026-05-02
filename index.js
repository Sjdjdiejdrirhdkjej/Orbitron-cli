#!/usr/bin/env node
/**
 * Orbitron TUI — minimal launcher for the standalone Node.js CLI.
 * Delegates to src/cli.js, which implements the full terminal UI.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Resolve src/cli.js relative to this file (index.js)
const selfDir = fs.existsSync(__dirname)
  ? __dirname
  : path.dirname(require.resolve(__filename));
const cliPath = path.resolve(selfDir, 'src', 'cli.js');

// Spawn the Node TUI, passing through all args and inheriting stdio
const child = spawn(
  process.execPath,
  ['--input-type=module', cliPath, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env },
  }
);

child.on('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 0);
});
child.on('error', (err) => {
  console.error(`Failed to start Orbitron TUI: ${err.message}`);
  process.exitCode = 1;
});
