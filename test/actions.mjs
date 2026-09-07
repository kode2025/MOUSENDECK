// Every button reports back. A tile that pulses green while nothing happened
// on the Mac is the worst failure mode this project has, because it sends you
// looking for the problem on the wrong machine.
//
// Needs a running server: `npm start` in another terminal, then
//   TOKEN=$(node -e "console.log(require('./config.json').token)") node test/actions.mjs
import { WebSocket } from 'ws';

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 8787;

/** Say what is wrong and what to do about it. A stack trace from deep inside
 *  ws only tells you the connection failed, which you already knew. */
function bail(msg, fix) {
  console.error(`\n  ✗ ${msg}\n`);
  if (fix) console.error(`${fix}\n`);
  process.exit(1);
}

if (!TOKEN) {
  bail('No TOKEN given, so the server would refuse the connection.',
       '    Run it like this, from the project root:\n\n' +
       '      TOKEN=$(node -e "console.log(require(\'./config.json\').token)") npm run test:actions');
}

// Match whichever scheme the server is running; a plain ws:// handshake
// against a TLS listener fails in a way that looks like the server is down.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
let SCHEME = 'http';
try { await fetch(`http://127.0.0.1:${PORT}/whois`); }
catch { SCHEME = 'https'; }
const WSCHEME = SCHEME === 'https' ? 'wss' : 'ws';
const ws = new WebSocket(`${WSCHEME}://127.0.0.1:${PORT}/?k=${TOKEN}`);

let fails = 0;
const chk = (n, c, extra = '') => { if (!c) fails++; console.log(`${c ? '✓' : '✗'} ${n}${extra}`); };

const results = [];
// Only one device drives the Mac at a time, so a real phone connected while
// this runs will take control back and every action after that is dropped by
// the CONTROL gate — which looks like "the feature is broken" rather than
// "something else is holding it". Say which it is.
let lostControlTo = null;
ws.on('message', (d, bin) => {
  if (bin) return;
  const m = JSON.parse(d);
  if (m.t === 'failed') results.push(m);
  if (m.t === 'released') lostControlTo = m.by || 'another device';
});

// These tests drive a *live* Mac, so unlike the console suite they cannot
// start their own server — the point is to watch real actions run.
await new Promise((resolve) => {
  ws.once('open', resolve);
  ws.once('error', (err) => {
    if (err.code === 'ECONNREFUSED') {
      bail(`Nothing is listening on port ${PORT}, so there is no server to test.`,
           '    Start one in another terminal first:\n\n' +
           '      connect\n\n' +
           '    then run this again. (The console tests, `npm test`, start their\n' +
           '    own server and need nothing running.)');
    }
    bail(`Could not connect: ${err.message}`);
  });
});

// Wait for the server to CONFIRM we hold control before firing anything.
// Sleeping and hoping was flaky: if a browser tab still held it, the first
// actions were silently dropped by the CONTROL gate and the test blamed the
// product for a race of its own making.
await new Promise((resolve, reject) => {
  const giveUp = setTimeout(
    () => reject(new Error('server never granted control')), 5000);
  const onMsg = (d, bin) => {
    if (bin) return;
    const m = JSON.parse(d);
    // 'granted' answers our takeover; 'hello' with no 'busy' means we are the
    // only client and already hold it.
    if (m.t === 'granted' || m.t === 'hello') {
      clearTimeout(giveUp);
      ws.off('message', onMsg);
      setTimeout(resolve, 150);
    }
  };
  ws.on('message', onMsg);
  ws.send(JSON.stringify({ t: 'takeover' }));
});

/** Fire an ad-hoc action and collect whatever comes back within the window. */
async function fire(action, ms = 2200) {
  if (lostControlTo) {
    bail(`${lostControlTo} took control of the Mac part-way through, so the rest`
         + ` of the actions were ignored.`,
         '    Close MouseNDeck on that device (or put it in pointer mode, which\n'
         + '    does not hold the deck) and run this again.');
  }
  results.length = 0;
  ws.send(JSON.stringify({ t: 'action', action }));
  await new Promise((r) => setTimeout(r, ms));
  return results[0] || null;
}

console.log('\n--- failures are reported, not swallowed ---');

const missingApp = await fire({ type: 'open', target: 'NoSuchApp' });
chk('a missing app is reported', /not installed/i.test(missingApp?.error || ''),
  `  → "${missingApp?.error || 'NOTHING CAME BACK'}"`);

const badShell = await fire({ type: 'shell', cmd: 'exit 7' });
chk('a failing command is reported', !!badShell?.error,
  `  → "${badShell?.error || 'NOTHING CAME BACK'}"`);

const stopRec = await fire({
  type: 'shell',
  cmd: 'pkill -INT screencapture || { echo "No recording is running." >&2; exit 1; }',
});
chk('Stop Recording explains there is nothing to stop',
  /No recording is running/.test(stopRec?.error || ''),
  `  → "${stopRec?.error || 'NOTHING CAME BACK'}"`);

const dnd = await fire({
  type: 'shell',
  cmd: 'shortcuts run "Toggle DND" 2>/dev/null || { echo "Do Not Disturb needs a one-time '
     + 'setup on the Mac. Open the Shortcuts app, create a shortcut named exactly \\"Toggle '
     + 'DND\\", give it the Set Focus action set to Do Not Disturb / Toggle, and save." >&2; exit 1; }',
});
chk('Do Not Disturb explains the one-time setup',
  /Shortcuts app/.test(dnd?.error || '') && /Toggle DND/.test(dnd?.error || ''),
  `\n     → "${(dnd?.error || 'NOTHING CAME BACK').slice(0, 120)}…"`);
chk('…and no longer puts a dialog on the Mac',
  !/display dialog|osascript/i.test(dnd?.error || ''));

// Longer window: this one runs two steps in series, and Launch Services can
// take its time deciding an app does not exist. The failure is reported
// either way — the test was just giving up before it arrived.
const badStep = await fire({
  type: 'multi',
  steps: [{ type: 'key', key: 'a', mods: [] }, { type: 'open', target: 'NoSuchApp' }],
}, 5000);
chk('a multi-step action names the step that failed', /step 2 of 2/.test(badStep?.error || ''),
  `  → "${badStep?.error || 'NOTHING CAME BACK'}"`);

console.log('\n--- things that work stay silent ---');

const finder = await fire({ type: 'open', target: '~' });
chk('Finder (open ~) reports no error', finder === null,
  finder ? `  → unexpected: ${finder.error}` : '');

const noop = await fire({ type: 'shell', cmd: 'true' });
chk('a successful command reports no error', noop === null,
  noop ? `  → unexpected: ${noop.error}` : '');

const longRunning = await fire({ type: 'shell', cmd: 'sleep 5' });
chk('a long-running command counts as started, not failed', longRunning === null,
  longRunning ? `  → unexpected: ${longRunning.error}` : '');

ws.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
