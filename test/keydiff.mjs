// Compare a REAL keystroke with the one this project synthesises.
//
// Written because three separate attempts at making ⌃← / ⌃→ switch Spaces
// failed, and each attempt was a guess about what a real keypress looks like.
// Guessing is the wrong method when the real thing is one key press away:
// this listens to both and prints them side by side, so the difference — if
// there is one — is visible rather than theorised.
//
// Run it FROM YOUR OWN TERMINAL; the listener needs Accessibility, which is
// granted to whichever app launches the process.
//
//   node test/keydiff.mjs
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const WATCH = join(ROOT, 'host', 'native', 'keywatch');
const BIN = join(ROOT, 'host', 'native', 'mdinput');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(WATCH)) {
  console.log('  building the listener…');
  execFileSync('swiftc', ['-O', '-o', WATCH, join(ROOT, 'host', 'native', 'keywatch.swift')],
    { stdio: 'inherit' });
}

const seen = [];
const watcher = spawn(WATCH, [], { stdio: ['ignore', 'pipe', 'inherit'] });
watcher.stdout.on('data', (d) => {
  for (const line of String(d).split('\n')) {
    const m = line.match(/^\s*([←→↑↓])\s+flags=(\S+)\s+\[([^\]]*)\]/);
    if (m) seen.push({ key: m[1], flags: m[2], mods: m[3] });
  }
});
await wait(1200);

console.log(`
  Comparing a real keystroke with a synthetic one
  ${'─'.repeat(56)}`);

// 1 — ours
seen.length = 0;
const child = spawn(BIN, [], { stdio: ['pipe', 'ignore', 'ignore'] });
await wait(300);
child.stdin.write(JSON.stringify({ t: 'key', key: 'right', mods: ['ctrl'] }) + '\n');
await wait(1200);
child.stdin.write(JSON.stringify({ t: 'key', key: 'left', mods: ['ctrl'] }) + '\n');
await wait(900);
child.stdin.end(); child.kill();
const ours = seen.filter((s) => s.key === '→')[0];
console.log(`  synthetic  ⌃→   ${ours ? `${ours.flags}  [${ours.mods}]` : 'NOT SEEN — nothing was posted'}`);

// 2 — yours
seen.length = 0;
console.log(`
  Now press  Control + →  on your Mac's own keyboard.
  Waiting…`);
const deadline = Date.now() + 30000;
let real = null;
while (Date.now() < deadline && !real) {
  await wait(200);
  real = seen.filter((s) => s.key === '→')[0];
}
watcher.kill();

if (!real) {
  console.log(`
  Nothing arrived in 30 seconds. Either the key was not pressed, or this
  terminal does not have Accessibility — in which case the listener sees
  nothing at all and the synthetic line above would also be empty.
`);
  process.exit(1);
}

console.log(`  real       ⌃→   ${real.flags}  [${real.mods}]`);
console.log(`
  ${'─'.repeat(56)}`);
if (ours && ours.flags === real.flags) {
  console.log(`  IDENTICAL. The event we send is indistinguishable from yours,
  so the difference is not in the keystroke — macOS is refusing it on
  the grounds of where it came from, not what it says. That cannot be
  fixed by sending a better keystroke.`);
} else if (ours) {
  const a = parseInt(ours.flags, 16), b = parseInt(real.flags, 16);
  console.log(`  DIFFERENT.  ours 0x${a.toString(16)}   yours 0x${b.toString(16)}`);
  console.log(`  bits yours has that ours lacks: 0x${(b & ~a).toString(16)}`);
  console.log(`  bits ours has that yours lacks: 0x${(a & ~b).toString(16)}`);
  console.log(`\n  That difference is the bug, and it is now a small fix.`);
}
console.log('');
