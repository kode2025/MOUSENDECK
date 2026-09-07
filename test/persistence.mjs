// A save must never be claimed unless it happened.
//
// Every state-changing message used to go out through sendJSON, which drops
// anything sent while the socket is down. Combined with an unconditional
// "Board saved" toast, that meant a Wi-Fi blip during Save changes lost your
// edits while telling you they were safe — the same class of lie as a deck
// tile flashing green for an action that never ran.
//
// This needs no server and no DOM: it lifts the durable-save block straight
// out of public/app.js and drives it, so it tests the code that ships rather
// than a paraphrase of it.
//
//   node test/persistence.mjs
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const from = src.indexOf('const pendingSaves = new Map();');
const to = src.indexOf('// ─── Latency probe', from);
if (from < 0 || to < 0) {
  console.error('\n  ✗ Could not find the durable-save block in public/app.js.\n');
  console.error('    It is delimited by `const pendingSaves` and the latency-probe');
  console.error('    banner. If those moved, update the anchors here.\n');
  process.exit(1);
}

let sent = [];
let toasts = [];
let open = false;

const ws = {
  get readyState() { return open ? 1 : 3; },   // 1 = OPEN, 3 = CLOSED
  send: (s) => sent.push(JSON.parse(s)),
};
const toast = (m) => toasts.push(m);

const { sendState, flushPendingSaves } =
  new Function('ws', 'toast', `${src.slice(from, to)}
    return { sendState, flushPendingSaves };`)(ws, toast);

let fails = 0;
const chk = (n, c, extra = '') => { if (!c) fails++; console.log(`${c ? '✓' : '✗'} ${n}${extra}`); };

console.log('\n--- socket up: straight through ---');
open = true;
chk('a save with the socket up reports true', sendState({ t: 'setboard', board: { v: 1 } }) === true);
chk('…and actually went out', sent.length === 1 && sent[0].board.v === 1);

console.log('\n--- socket down: held, not lost ---');
open = false; sent = [];
chk('a save with the socket down reports false', sendState({ t: 'setboard', board: { v: 2 } }) === false,
  '  ← this is what stops the UI claiming it saved');
chk('…and nothing was sent yet', sent.length === 0);

console.log('\n--- last writer wins per kind ---');
sendState({ t: 'setboard', board: { v: 3 } });
open = true; flushPendingSaves();
chk('only the latest board is replayed', sent.length === 1, `  → ${sent.length} message(s)`);
chk('…and it is the newest one', sent[0]?.board.v === 3, `  → v${sent[0]?.board.v}`);
chk('the replay says so out loud', /Saved to the Mac/.test(toasts.at(-1) || ''), `  → "${toasts.at(-1)}"`);

console.log('\n--- setprefs merges instead of clobbering ---');
// setprefs carries a subset of the preferences, so two held at once must
// merge. Keeping only the later one would drop the custom-shortcut library.
open = false; sent = []; toasts = [];
sendState({ t: 'setprefs', prefs: { customs: ['a'] } });
sendState({ t: 'setprefs', prefs: { lefty: true } });
open = true; flushPendingSaves();
const prefs = sent.find((m) => m.t === 'setprefs')?.prefs || {};
chk('the earlier pref survives a later one', JSON.stringify(prefs.customs) === '["a"]',
  `  → customs=${JSON.stringify(prefs.customs)}`);
chk('…alongside the later one', prefs.lefty === true, `  → lefty=${prefs.lefty}`);

console.log('\n--- several kinds at once ---');
open = false; sent = []; toasts = [];
sendState({ t: 'setboard', board: { v: 9 } });
sendState({ t: 'setpointer', pointer: { speed: 20 } });
open = true; flushPendingSaves();
chk('both kinds are replayed', sent.length === 2, `  → ${sent.map((m) => m.t).join(', ')}`);
chk('and the count is reported', /Saved 2 changes/.test(toasts.at(-1) || ''), `  → "${toasts.at(-1)}"`);

console.log('\n--- nothing held, nothing said ---');
sent = []; toasts = [];
flushPendingSaves();
chk('a reconnect with nothing pending is silent', sent.length === 0 && toasts.length === 0);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
