// Why is nothing happening when I swipe with three fingers?
//
// The gesture crosses four boundaries — phone, network, Node, and the Swift
// helper — and only the last one can actually fail silently. So this cuts the
// first three out: it drives the input helper directly and fires the same
// ⌃← / ⌃→ a three-finger swipe would.
//
// Run it FROM YOUR OWN TERMINAL. Accessibility is granted to the app that
// launches a process, so run from anywhere else and this reports "untrusted"
// no matter what you have ticked in System Settings.
//
//   node test/spaces.mjs
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const BIN = join(ROOT, 'host', 'native', 'mdinput');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(BIN)) {
  console.error('\n  ✗ The input helper is not built.\n\n      npm run build\n');
  process.exit(1);
}

console.log('\n  Three-finger swipe diagnosis');
console.log('  ' + '─'.repeat(58));

// 1 — can we post events at all?
let trusted = false;
try { trusted = execFileSync(BIN, ['--check'], { encoding: 'utf8' }).trim() === 'trusted'; }
catch { trusted = false; }
console.log(`  Accessibility          ${trusted ? '✓ granted' : '✗ NOT granted'}`);
if (!trusted) {
  console.error(`
  Nothing can move the pointer or press a key without it.

    System Settings → Privacy & Security → Accessibility
    → add this terminal → quit it fully (⌘Q) → reopen → run this again.
`);
  process.exit(1);
}

// 2 — does macOS even have the shortcuts turned on?
const NAMES = { 79: 'Move left a space   ⌃←', 81: 'Move right a space  ⌃→',
                32: 'Mission Control     ⌃↑', 33: 'Application windows ⌃↓' };
let hk = {};
try {
  const raw = execFileSync('defaults', ['export', 'com.apple.symbolichotkeys', '-'],
    { encoding: 'utf8' });
  for (const id of Object.keys(NAMES)) {
    const m = raw.match(new RegExp(`<key>${id}</key>\\\\s*<dict>([\\\\s\\\\S]*?)</dict>`));
    // Absent from the plist means untouched, which means on.
    hk[id] = m ? !/<key>enabled<\/key>\s*<false\/>/.test(m[1]) : true;
  }
} catch { hk = null; }

if (hk) {
  for (const [id, name] of Object.entries(NAMES)) {
    console.log(`  ${name}   ${hk[id] ? '✓ enabled' : '✗ TURNED OFF in System Settings'}`);
  }
  if (Object.values(hk).some((v) => !v)) {
    console.log(`
  A shortcut that is off cannot be triggered by anything — not this, not
  your own keyboard. Turn it back on in
     System Settings → Keyboard → Keyboard Shortcuts… → Mission Control
`);
  }
}

// 3 — fire them for real, and let the human be the assertion. There is no way
//     to ask macOS "did a Space change?", so watching is the measurement.
const child = spawn(BIN, [], { stdio: ['pipe', 'ignore', 'inherit'] });
const key = (k, mods) => child.stdin.write(JSON.stringify({ t: 'key', key: k, mods }) + '\n');

console.log(`
  Now watch your screen. Firing the same keystrokes a three-finger
  swipe sends — this is exactly what the gesture does.
`);

for (const [n, k, label] of [[3, 'right', '⌃→  next space'], [2, 'left', '⌃←  previous space']]) {
  for (let i = n; i > 0; i--) { process.stdout.write(`\r  ${label} in ${i}… `); await wait(1000); }
  process.stdout.write(`\r  ${label}  — now       \n`);
  key(k, ['ctrl']);
  await wait(1400);
}

child.stdin.end();
child.kill();

console.log(`
  ${'─'.repeat(58)}
  Did the desktop change?

    YES  — the Mac is fine, so the problem is the gesture not being
           recognised on the device. Watch the finger counter in the
           pad's top-left corner while you swipe.

    NO   — macOS is refusing the synthetic keystroke itself. Report
           this along with your macOS version; the Space ← / Space →
           buttons in the catalog's Windows category use exactly the
           same keystroke, so try one of those too — if a BUTTON works
           and the swipe does not, the problem is the gesture, not the
           key.
`);
