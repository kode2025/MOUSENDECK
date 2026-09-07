// Owns the `mdinput` child process and feeds it newline-delimited JSON.
// Auto-restarts so a crash never takes the whole server down with it.

import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';

const BIN = join(ROOT, 'host', 'native', 'mdinput');

let child = null;
let restarts = 0;
let restartTimer = null;

function start() {
  if (!existsSync(BIN)) {
    console.error(`\n  mdinput binary missing. Build it with:  npm run build\n`);
    return;
  }
  child = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'pipe'] });

  child.stderr.on('data', (d) => process.stderr.write(`[mdinput] ${d}`));
  child.on('exit', (code, signal) => {
    child = null;
    if (shuttingDown) return;
    // Back off so a persistently broken binary doesn't spin the CPU.
    const delay = Math.min(1000 * 2 ** restarts++, 30000);
    console.error(`[mdinput] exited (${signal || code}); restarting in ${delay}ms`);
    restartTimer = setTimeout(start, delay);
  });
  child.on('error', (err) => console.error(`[mdinput] ${err.message}`));

  // A clean run for a few seconds means the backoff can reset.
  setTimeout(() => { if (child) restarts = 0; }, 5000);
}

let shuttingDown = false;
export function stopInput() {
  shuttingDown = true;
  clearTimeout(restartTimer);
  child?.kill();
}

export function send(cmd) {
  if (!child?.stdin.writable) return false;
  try {
    child.stdin.write(`${JSON.stringify(cmd)}\n`);
    return true;
  } catch {
    return false;
  }
}

/** Does this process have Accessibility permission to post events? */
export function checkAccessibility() {
  if (!existsSync(BIN)) return 'missing-binary';
  try {
    const out = execFileSync(BIN, ['--check'], { encoding: 'utf8' }).trim();
    return out === 'trusted' ? 'trusted' : 'untrusted';
  } catch {
    return 'untrusted';
  }
}

start();
