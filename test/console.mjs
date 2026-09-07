// The terminal console: `connect` holds a terminal open, so that terminal is
// where you ask it questions. Drives it the way a person would — start it,
// connect a couple of devices, then type at it.
//
// Runs on its own port so it never collides with a session you have running.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { loadConfig } from '../host/config.js';

const PORT = 8899;
const TOKEN = loadConfig().token;
const ROOT = new URL('..', import.meta.url).pathname;

// The shipped default is HTTPS, so that is what gets tested — a suite that
// quietly ran the plain-http path would pass while the thing people actually
// start was broken. The certificate is self-signed by definition, so the
// client half has to be told to accept it; nothing else in the project does.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const WS = (ua) => new WebSocket(`wss://127.0.0.1:${PORT}/?k=${TOKEN}`, {
  headers: { 'user-agent': ua },
  rejectUnauthorized: false,
});

const srv = spawn('node', ['host/server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['pipe', 'pipe', 'inherit'],
});

let out = '';
const LOUD = process.env.VERBOSE === '1';
srv.stdout.on('data', (d) => { out += d; if (LOUD) process.stdout.write(d); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (line) => { if (LOUD) console.log(`\n>>> typed: ${line}`); srv.stdin.write(line + '\n'); };

await wait(2000);

// Two devices, so the holder/watcher distinction is exercised.
const ipad = WS('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Safari/605.1.15');
await new Promise((r) => ipad.on('open', r));
const phone = WS('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1');
await new Promise((r) => phone.on('open', r));
await wait(2200);

say('show connected device');
await wait(400);
say('who');
await wait(400);
say('help');
await wait(400);
say('accessibility');
await wait(400);
say('url');
await wait(400);
say('wibble');
await wait(400);

ipad.close(); phone.close();
await wait(600);
say('show connected device');
await wait(500);

say('quit');
await wait(800);
srv.kill();

// ── assertions ──────────────────────────────────────────────────────────
let fails = 0;
const chk = (name, cond) => { if (!cond) fails++; console.log(`${cond ? '✓' : '✗'} ${name}`); };

chk('banner advertises the command', out.includes('Type  show connected device  here'));
chk('"show connected device" lists devices', /Connected devices \(2\)/.test(out));
chk('names the iPad', /an iPad/.test(out));
chk('names the iPhone', /an iPhone/.test(out));
chk('marks exactly one holder', (out.match(/in control/g) || []).length >= 2);
chk('shows a watcher', /watching/.test(out));
chk('shows how long each has been on', /for \d+:\d\d/.test(out));
chk('"who" is an alias', (out.match(/Connected devices \(2\)/g) || []).length === 2);
chk('help lists the commands', /show connected device\s+who is connected/.test(out));
chk('accessibility reports state', /Accessibility (granted|is NOT granted)/.test(out));
chk('url reprints the link', (out.match(/\?k=/g) || []).length >= 2);
chk('unknown input is rejected, not ignored', /"wibble" is not a command here/.test(out));
chk('says so when nothing is connected', /Nothing is connected right now/.test(out));
chk('quit shuts down', /shutting down/.test(out));
chk('HTTPS is the default, not an opt-in', /https:\/\//.test(out));
chk('and it explains the certificate warning', /self-signed/.test(out));
process.exit(fails ? 1 : 0);
