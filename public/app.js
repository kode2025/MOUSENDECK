// app.js — the whole client. Everything the phone or iPad does lives here.
//
// It is one file on purpose: it is served over a LAN to a device that may be
// on a slow link, and a bundler, a module graph and a dozen round trips buy
// nothing when the total is under 120 KB. There is no build step for the
// client — what you edit is what runs.
//
// What it contains, in the order it appears:
//
//   Token & device memory  the access token from the QR, remembered so a
//                          Home Screen icon reconnects on its own; and
//                          detectLayout(), which decides iPad vs phone
//   Socket                 the WebSocket to the Mac, with reconnect,
//                          and sendState() for anything that must survive a
//                          dropped connection
//   Binary hot path        preallocated 5-byte frames for pointer motion, so
//                          no garbage is produced while a finger is moving
//   Latency probe          the round-trip readout in the header
//   Trackpad              touch handling: taps, drags, scroll, pinch, the
//                          rest-and-slide selection gesture, 3- and 4-finger
//                          swipes
//   Air pointer            gyroscope aiming — posture gate, calibration, and
//                          the separate full-screen pointer UI
//   Panes                  the Deck / Pad / Keys toggles and the layout gate
//   Board                  rendering, drag-to-reorder, transactional editing
//   Catalog                the built-in shortcut picker, as toggles
//   Editor                 building a custom button of any action type
//   Key picker             recording a key combination in press order
//   Keyboards              the on-screen keyboard for the Mac, plus the
//                          purpose-built phone layout
//   Settings               both sheets, and what is stored where
//
// Two rules run through all of it:
//   · Never claim something worked. A tile goes red when its action failed,
//     and a save is only reported as saved once the Mac has heard it.
//   · Never offer what cannot work. The host declares its capabilities and
//     anything unsupported is filtered out before it is ever drawn.

'use strict';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};
const uid = () => Math.random().toString(16).slice(2, 14);

// ─── Token & device memory ────────────────────────────────────────────────
// The token arrives once in the URL, then lives in localStorage so the
// home-screen icon reconnects on its own.

const params = new URLSearchParams(location.search);
if (params.get('k')) {
  localStorage.setItem('mnd.token', params.get('k'));
  history.replaceState({}, '', location.pathname);
}
const TOKEN = localStorage.getItem('mnd.token') || '';

/**
 * Which layout this device wants.
 *
 * Deliberately *not* shared through the host like the other settings: it
 * describes the screen in your hand, not the setup. Sharing it meant an iPad
 * choosing the landscape layout also forced it onto a phone, which then asked
 * to be turned sideways forever.
 *
 * iPadOS reports a Mac user-agent, so the short edge of the screen is the
 * reliable signal — phones are around 390-430pt, tablets 768 and up.
 */
/**
 * Work out which layout this screen wants, from scratch, every launch.
 *
 * It used to remember a manual override forever, which sounds helpful and is
 * not: one stray tap of the layout button and an iPad is stuck in the phone
 * layout across every future session, with no hint why. Detection runs each
 * time instead, and the header button overrides it for the session only.
 *
 * The user agent alone cannot do this. iPadOS reports itself as a Mac — the
 * same string a real MacBook sends — so `Macintosh` means "iPad or Mac" and
 * has to be split on touch support. The screen's short edge is the reliable
 * signal: phones sit around 375-430pt, tablets at 768 and up.
 */
function detectLayout() {
  const ua = navigator.userAgent;
  if (/iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) return 'mobile';

  // An iPad claiming to be a Mac gives itself away with touch points.
  const touchTablet = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (touchTablet) return 'ipad';

  const shortEdge = Math.min(screen.width, screen.height);
  return shortEdge < 700 ? 'mobile' : 'ipad';
}

function guessLayout() {
  return detectLayout();
}

const state = {
  connected: false,
  identity: null,
  caps: null,
  cfg: null,
  peers: [],
  device: null,
  sessionStart: 0,
  page: 0,
  platform: 'macos',
  layout: guessLayout(),
  // Deck and Pad are independent toggles; Keys is an overlay that borrows the
  // whole stage and hands it straight back. Device-local, like the layout.
  show: (() => {
    try {
      const v = JSON.parse(localStorage.getItem('mnd.show') || 'null');
      if (v && (v.board || v.pad)) return v;
    } catch { /* fall through */ }
    // A phone has no room for both, so it opens on the trackpad.
    return detectLayout() === 'mobile'
      ? { board: false, pad: true }
      : { board: true, pad: true };
  })(),
  keysOnly: false,
  showBeforeKeys: null,
  // Which of the two columns the iPad layout shows. Device-local, like the
  // layout choice — it describes the screen in your hand, not the setup.
  hasControl: true,
  editing: false,
  dirty: false,
  snapshot: null,
  lefty: false,
  customs: [],
};

// ─── Toast ────────────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ─── Socket ───────────────────────────────────────────────────────────────
// The socket to the serving host opens immediately and stays open — it is how
// we learn about other machines. "Disconnected" in the UI means "not driving
// a device", which is deliberately separate from socket state.

let ws = null;
let retry = 0;

function openSocket() {
  // ws:// from an https page is mixed content and the browser blocks it
  // outright, so the socket scheme has to follow the page's.
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/?k=${encodeURIComponent(TOKEN)}`);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    retry = 0;
    $('dot').className = 'dot ok';
    // Anything saved while the socket was down goes now, before anything else.
    flushPendingSaves();
  };
  ws.onclose = () => {
    $('dot').className = 'dot bad';
    $('latency').textContent = '';
    if (state.connected) {
      // Keep the session alive across a blip; the timer keeps running so a
      // brief Wi-Fi stumble doesn't look like you disconnected.
      toast('Connection lost — reconnecting…');
    }
    setTimeout(openSocket, Math.min(300 * 2 ** retry++, 5000));
  };
  ws.onerror = () => ws.close();
  ws.onmessage = onMessage;
}

function onMessage(e) {
  if (e.data instanceof ArrayBuffer) {
    const b = new DataView(e.data);
    if (b.getUint8(0) === 6) gotPong(b.getUint32(1, true));
    return;
  }
  let m;
  try { m = JSON.parse(e.data); } catch { return; }

  if (m.t === 'hello') {
    state.identity = m.identity;
    state.caps = m.capabilities;
    state.cfg = m.config;
    // The shortcut vocabulary follows the machine you are actually driving,
    // not a saved preference. Connected to a Mac you get ⌘C; connected to a
    // Windows host you would get Ctrl+C. A stored value cannot know which
    // machine you just scanned into, so the host's own report wins.
    state.platform = m.capabilities?.os === 'windows' ? 'windows' : 'macos';
    state.lefty = !!m.config.lefty;
    state.customs = m.config.customs || [];
    state.peers = m.peers || [];
    onHello();
  } else if (m.t === 'busy') {
    // Someone else has the Mac. Say who, and offer to take it rather than
    // leaving this device permanently stuck behind a stale tab.
    state.hasControl = false;
    $('busy-p').textContent =
      `${m.holder?.name || 'Another device'} is controlling this Mac right now.`;
    $('busy').hidden = false;
  } else if (m.t === 'granted') {
    state.hasControl = true;
    $('busy').hidden = true;
    toast('You have control');
  } else if (m.t === 'released') {
    state.hasControl = false;
    $('busy-p').textContent = `${m.by || 'Another device'} took over control of this Mac.`;
    $('busy').hidden = false;
  } else if (m.t === 'failed') {
    // The Mac refused or could not run it. Say so on the device holding the
    // button — the tile's green pulse only proves the message arrived.
    failTile(m.id);
    showFailure(m.label, m.error);
  } else if (m.t === 'peers') {
    state.peers = m.peers || [];
  } else if (m.t === 'config') {
    state.cfg = m.config;
    // A config broadcast must not change the vocabulary — the host it
    // describes has not changed underneath us.
    state.lefty = !!m.config.lefty;
    state.customs = m.config.customs || [];
    applyPlatform();
    renderBoard();
    syncSettings();
  }
}

/** Flash the tile that failed. Knowing *which* button broke matters as much as
 *  knowing one did — on a 30-button board they all pulse the same green. */
function failTile(id) {
  if (!id) return;
  const t = document.querySelector(`.tile[data-id="${id}"]`);
  if (!t) return;
  t.classList.remove('fired');
  t.classList.add('failed');
  setTimeout(() => t.classList.remove('failed'), 2000);
}

/** Short problems are a toast. Anything long enough to be instructions gets a
 *  panel, because a permission fix you cannot finish reading is not a fix. */
function showFailure(label, error) {
  const msg = error || 'It did not run.';
  const head = label ? `${label} didn't run` : `That didn't run`;
  if (msg.length <= 72) { toast(`${head} — ${msg}`); return; }
  $('fail-h').textContent = head;
  $('fail-p').textContent = msg;
  $('fail-hint').textContent = /Automation|Privacy/i.test(msg)
    ? 'You will need to be at the Mac for this one. Nothing here can grant it remotely.'
    : '';
  openSheet('failure');
}

/**
 * Built-in buttons are locked, so their action should always match the catalog
 * entry they claim to be. When a catalog entry is corrected — as Finder and Do
 * Not Disturb both were — boards saved earlier still carry the old, broken
 * action. Refresh them rather than leaving a button that quietly does the
 * wrong thing.
 */
function refreshBuiltins() {
  const byId = new Map();
  for (const c of [...(window.CATALOG || []), ...(window.CATALOG_WINDOWS || [])]) {
    byId.set(c.id, c);
  }

  let changed = 0;
  for (const page of state.cfg.board.pages) {
    for (const b of page.buttons) {
      if (!b.builtin) continue;                  // never touch a custom button
      const c = byId.get(b.builtin);
      if (!c) continue;
      if (JSON.stringify(b.action) !== JSON.stringify(c.action)) {
        b.action = structuredClone(c.action);
        changed++;
      }
    }
  }
  if (changed) {
    flushBoard();
    toast(`Updated ${changed} built-in shortcut${changed === 1 ? '' : 's'}`);
  }
  return changed;
}

let zoomReady = false;
// Asked once per launch, not once per connection — a Wi-Fi blip reconnects and
// should not put the question back up while you are mid-gesture.
let launchAsked = false;

function showLaunch() {
  document.body.dataset.launch = '1';
  $('launch').hidden = false;
}

function hideLaunch() {
  document.body.dataset.launch = '0';
  $('launch').hidden = true;
}

$('launch-app').addEventListener('click', hideLaunch);
$('launch-pointer').addEventListener('click', () => {
  hideLaunch();
  // Straight into the same permission-then-posture flow as the ✥ button; the
  // gate still has to be acknowledged, because the axis mapping depends on it.
  toggleAir();
});

function onHello() {
  syncSettings();
  refreshBuiltins();
  applyPlatform();
  // Scanning the QR *is* the connection. There is exactly one Mac — the one
  // that served this page — so there is nothing to choose and no reason to
  // make the user tap "connect" before the trackpad works.
  const me = {
    id: state.identity.id,
    name: state.identity.name,
    os: state.caps?.os || 'macos',
    host: location.hostname,
    port: Number(location.port) || 8787,
  };
  setConnected(true, me, { keepTimer: state.connected });
  // After the board exists, so "fit" has a real row count to work from. Only
  // the first hello decides it; a reconnect must not undo a chosen size.
  if (!zoomReady) { zoomReady = true; initZoom(); }

  // Only once the Mac has answered, and never over the in-use lock — being
  // told to choose a mode you cannot use yet is worse than waiting a beat.
  if (!launchAsked && state.hasControl) {
    launchAsked = true;
    showLaunch();
  }
}

// ─── Binary hot path ──────────────────────────────────────────────────────
// One preallocated buffer per opcode: no garbage is produced while a finger is
// moving, so the GC never stutters mid-gesture.

const bMove = new ArrayBuffer(5), vMove = new DataView(bMove);
const bScroll = new ArrayBuffer(5), vScroll = new DataView(bScroll);
const bBtn = new ArrayBuffer(2), vBtn = new DataView(bBtn);
const bClick = new ArrayBuffer(3), vClick = new DataView(bClick);
const bPing = new ArrayBuffer(5), vPing = new DataView(bPing);
vMove.setUint8(0, 1); vScroll.setUint8(0, 2); vClick.setUint8(0, 5); vPing.setUint8(0, 6);

const live = () => ws?.readyState === 1 && state.connected;
// How much unsent motion the socket may hold before we stop adding to it.
//
// This used to be 4096 bytes, which sounds cautious and is not: at 5 bytes a
// frame it is eight hundred queued moves. When a Wi-Fi stall clears, all of
// them are delivered, and the cursor spends the next several seconds flying
// through where your finger USED to be. 256 bytes is about fifty frames —
// still plenty of slack for an ordinary hiccup, and past that the deltas go
// into accX/accY instead, where they merge. Motion is only worth sending
// while it is still true.
const BACKPRESSURE = 256;
const clamp16 = (n) => (n > 32767 ? 32767 : n < -32768 ? -32768 : n);

let accX = 0, accY = 0, accSX = 0, accSY = 0;   // sub-pixel remainders

// When motion last went out. The keep-alive uses this to stand down while a
// gesture is in flight — see the probe below.
let lastMotionAt = 0;

function sendMove(dx, dy) {
  accX += dx; accY += dy;
  const ix = Math.trunc(accX), iy = Math.trunc(accY);
  if (!ix && !iy) return;
  accX -= ix; accY -= iy;
  // If the socket is backing up, keep accumulating instead of queueing more —
  // otherwise the cursor drifts on after your finger has stopped.
  if (!live() || ws.bufferedAmount > BACKPRESSURE) { accX += ix; accY += iy; return; }
  vMove.setInt16(1, clamp16(ix), true);
  vMove.setInt16(3, clamp16(iy), true);
  ws.send(bMove);
  lastMotionAt = performance.now();
}

function sendScroll(dx, dy) {
  accSX += dx; accSY += dy;
  const ix = Math.trunc(accSX), iy = Math.trunc(accSY);
  if (!ix && !iy) return;
  accSX -= ix; accSY -= iy;
  if (!live() || ws.bufferedAmount > BACKPRESSURE) { accSX += ix; accSY += iy; return; }
  vScroll.setInt16(1, clamp16(ix), true);
  vScroll.setInt16(3, clamp16(iy), true);
  ws.send(bScroll);
  lastMotionAt = performance.now();
}

const BTN = { left: 0, right: 1, middle: 2 };
function sendBtn(op, name) {
  if (!live()) return;
  vBtn.setUint8(0, op); vBtn.setUint8(1, BTN[name] ?? 0);
  ws.send(bBtn);
}
const mouseDown = (b) => sendBtn(3, b);
const mouseUp = (b) => sendBtn(4, b);
function sendClick(name, n = 1) {
  if (!live()) return;
  vClick.setUint8(1, BTN[name] ?? 0); vClick.setUint8(2, n);
  ws.send(bClick);
}
const sendJSON = (o) => { if (ws?.readyState === 1) ws.send(JSON.stringify(o)); };

// Input is worthless late — a click that arrives after the socket comes back
// clicks the wrong thing — so sendJSON drops it and that is correct. Saved
// state is the opposite: it is still true a second later, and dropping it
// silently is how you press "Save changes", get told "Board saved", and find
// the Mac never heard about it.
//
// These messages are last-writer-wins, so this is not a queue: two board saves
// in a row mean the second one is the truth. Hold the latest of each kind and
// replay it when the socket returns.
const pendingSaves = new Map();

/** Send something that represents saved state. Returns whether it actually
 *  went out, so the caller can tell the truth about what just happened. */
function sendState(o) {
  if (ws?.readyState === 1) { ws.send(JSON.stringify(o)); return true; }
  // setprefs carries a SUBSET of the preferences, so two held at once have to
  // merge — keeping only the later one would silently drop the earlier change.
  const held = pendingSaves.get(o.t);
  if (held && o.t === 'setprefs') {
    o = { t: 'setprefs', prefs: { ...held.prefs, ...o.prefs } };
  }
  pendingSaves.set(o.t, o);
  return false;
}

/** Replayed on reconnect. Says so out loud: you were told it had not saved,
 *  so you have to be told when it did. */
function flushPendingSaves() {
  if (!pendingSaves.size || ws?.readyState !== 1) return;
  for (const o of pendingSaves.values()) ws.send(JSON.stringify(o));
  const n = pendingSaves.size;
  pendingSaves.clear();
  toast(n === 1 ? 'Saved to the Mac' : `Saved ${n} changes to the Mac`);
}

// ─── Latency probe ────────────────────────────────────────────────────────
// Doubles as a keep-alive: a steady trickle of packets stops the iOS Wi-Fi
// radio dropping into a power-save state that adds tens of ms on wake.

// The probe carries its own timestamp, which the host echoes back verbatim.
// Timing against a single shared variable silently mis-measures whenever two
// probes are in flight at once — and on a slow link they always are.
let rttSmooth = 0, rttBest = Infinity, lastShown = 0;
const T0 = performance.now();

// 100 ms rather than a lazier interval on purpose: iOS parks the Wi-Fi radio
// in a power-saving state after a short idle, and waking it costs tens of
// milliseconds on the *next* packet — exactly the one you notice, because it
// is the first movement after a pause. A steady trickle keeps it awake.
const PING_MS = 100;

setInterval(() => {
  if (ws?.readyState !== 1 || ws.bufferedAmount > BACKPRESSURE) return;
  // Stand down while a gesture is running. The probe is here to keep the Wi-Fi
  // radio out of power-save; during motion it is already awake, so a ping in
  // the middle of a swipe buys nothing and puts a frame in front of the one
  // that matters. It resumes on its own the moment your finger stops.
  if (performance.now() - lastMotionAt < PING_MS) return;
  vPing.setUint32(1, Math.round(performance.now() - T0) >>> 0, true);
  ws.send(bPing);
}, PING_MS);

function gotPong(sentAt) {
  const rtt = (performance.now() - T0) - sentAt;
  if (!(rtt >= 0 && rtt < 5000)) return;              // ignore nonsense

  rttSmooth = rttSmooth ? rttSmooth * 0.8 + rtt * 0.2 : rtt;
  // The floor matters more than the average: it is what the link can actually
  // do, with the spikes from radio wake-ups excluded.
  if (rtt < rttBest) rttBest = rtt;

  const now = performance.now();
  if (now - lastShown < 700) return;
  lastShown = now;

  const l = $('latency');
  const avg = Math.round(rttSmooth);
  l.textContent = rttBest < avg - 1 ? `${avg} ms · best ${Math.round(rttBest)}` : `${avg} ms`;
  l.className = 'latency ' + (avg < 15 ? 'good' : avg < 40 ? 'okish' : 'poor');
  l.title = `round trip: ${avg} ms average, ${Math.round(rttBest)} ms best.\n`
          + `Your iPad samples touch every 16.7 ms (60 Hz), so that frame is `
          + `the floor for how fast a movement can possibly feel.`;
}

// Let the display settle again after a network change rather than keeping a
// best-case number from a different Wi-Fi forever.
setInterval(() => { rttBest = Infinity; }, 60000);

// ─── Session ──────────────────────────────────────────────────────────────

let timerInt = null;

function fmtDuration(s) {
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}

function tickTimer() {
  const s = Math.floor((Date.now() - state.sessionStart) / 1000);
  $('timer').textContent = fmtDuration(s);
}

/** Scanning the QR is the connection, so this runs itself the moment the host
 *  says hello — there is no Connect button to press. */
function setConnected(on, device, { keepTimer = false } = {}) {
  state.connected = on;
  state.device = on ? device : null;
  $('stage').dataset.connected = on ? '1' : '0';

  $('devchip').hidden = !on;
  $('timer').hidden = !on;

  clearInterval(timerInt);
  if (on) {
    $('devname').textContent = device.name;
    $('devchip').setAttribute('aria-label', `Connected to ${device.name}`);
    // A reconnect mid-session keeps counting rather than restarting at zero.
    if (!keepTimer) state.sessionStart = Date.now();
    tickTimer();
    timerInt = setInterval(tickTimer, 1000);
    keepAwake();
  } else {
    $('latency').textContent = '';
  }
  renderBoard();
}

// ─── Screen wake lock ─────────────────────────────────────────────────────
// Without this the screen dims, then sleeps, then the socket dies mid-use.
async function keepAwake() {
  try { await navigator.wakeLock?.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.connected) keepAwake();
});

// ─── Trackpad ─────────────────────────────────────────────────────────────
//
// Finger counts, and what each honestly does:
//
//   1  drag           move the pointer (speed-based acceleration)
//   1  tap            left click        · double tap → double click
//   1  tap-then-drag  click and drag
//   2  drag           scroll
//   2  pinch/spread   zoom out / in
//   2  tap            right click
//   3  swipe ←→↑↓     spaces / Mission Control / Task View
//   3  tap            middle click
//   4  swipe ←→↑↓     desktop switching
//   4  pinch/spread   Launchpad / Show Desktop
//
// The three- and four-finger gestures are delivered as the equivalent keyboard
// shortcut. macOS will not let a synthesised event impersonate real
// multi-touch — the window server reads those from the trackpad hardware
// directly — so a "real" swipe is not something any app can send. The
// keyboard route produces the identical result.
//
// Force Touch is not emulated: the iPad 9 has no pressure sensor under the
// glass. What a MacBook trackpad varies by *speed* is already here, as the
// acceleration curve below.

const pad = $('pad');

const TAP_MS = 250;        // longer than this is a hold, not a tap
const TAP_SLOP = 10;       // px of wander still counted as a tap
const DOUBLE_MS = 300;
const DOUBLE_SLOP = 40;
const SWIPE_MIN = 45;      // px before a multi-finger drag counts as a swipe
const PINCH_MIN = 45;      // px of spread change before it is read as a pinch
const ZOOM_STEP = 38;      // further px of spread per additional zoom step
const SWIPE_STEP = 90;     // further px of travel per additional swipe
// Separate cooldowns: zoom wants to feel continuous under a slow pinch, while
// flicking through Spaces eight times a second would be unusable.
const ZOOM_REPEAT_MS = 55;
const SWIPE_REPEAT_MS = 260;
const REST_SLOP = 14;      // px a finger may drift and still count as resting

/** Multi-finger gestures, per platform, as the shortcut that reproduces them. */
const GESTURES = {
  macos: {
    3: { up:    ['up',    ['ctrl']],  down:  ['down',  ['ctrl']],
         left:  ['left',  ['ctrl']],  right: ['right', ['ctrl']] },
    4: { up:    ['up',    ['ctrl']],  down:  ['f11',   []],
         left:  ['left',  ['ctrl']],  right: ['right', ['ctrl']] },
    pinchIn:  ['space', ['cmd', 'alt']],   // Launchpad
    pinchOut: ['f11',   []],               // Show Desktop
    zoomIn:   ['=', ['cmd']],
    zoomOut:  ['-', ['cmd']],
  },
  windows: {
    3: { up:    ['tab',   ['win']],   down:  ['d',     ['win']],
         left:  ['tab',   ['alt']],   right: ['tab',   ['alt']] },
    4: { up:    ['tab',   ['win']],   down:  ['d',     ['win']],
         left:  ['left',  ['win', 'ctrl']], right: ['right', ['win', 'ctrl']] },
    pinchIn:  ['tab', ['win']],
    pinchOut: ['d',   ['win']],
    zoomIn:   ['=', ['ctrl']],
    zoomOut:  ['-', ['ctrl']],
  },
};

const gestureSet = () => GESTURES[state.platform] || GESTURES.macos;

function fireCombo(pair, why) {
  if (!pair) return;
  sendJSON({ t: 'key', key: pair[0], mods: pair[1] });
  if (why) toast(why);
}

const g = {
  mode: 'idle',            // idle | move | scroll | swipe | drag
  startT: 0, startX: 0, startY: 0,
  lastX: 0, lastY: 0, lastT: 0,
  moved: false, maxFingers: 0, dragging: false, armedDouble: false,
  swipeX: 0, swipeY: 0,    // travel banked since the last swipe fired
  startSpread: 0, spread: 0, lastSpread: 0,
  pinching: false, pinchBank: 0,
  lastFire: 0,
  starts: new Map(),       // touch identifier -> where that finger landed
  dragSelect: false,       // rest one finger, slide another: click and drag
  dragId: null,            // which finger is doing the sliding
  dragLast: null,
};

/** Rate-limited so a single quick gesture cannot fire a burst of repeats. */
function fireRepeat(pair, minGap, why) {
  const now = performance.now();
  if (now - g.lastFire < minGap) return false;
  g.lastFire = now;
  fireCombo(pair, why);
  return true;
}
let lastTapT = 0, lastTapX = 0, lastTapY = 0;

const centroid = (touches) => {
  let x = 0, y = 0;
  for (const t of touches) { x += t.clientX; y += t.clientY; }
  return { x: x / touches.length, y: y / touches.length };
};

/** Mean distance from the centroid — grows as fingers spread apart. */
function spreadOf(touches) {
  if (touches.length < 2) return 0;
  const c = centroid(touches);
  let sum = 0;
  for (const t of touches) sum += Math.hypot(t.clientX - c.x, t.clientY - c.y);
  return sum / touches.length;
}

pad.addEventListener('touchstart', (e) => {
  // A touch that starts on one of the pad's own buttons belongs to the button.
  // The preventDefault below is what stops iOS scrolling the page, and it also
  // cancels the synthesised click on anything nested inside — which is exactly
  // why tapping the air-pointer button did nothing on a phone.
  if (e.target.closest && e.target.closest('.pad-btn')) return;
  e.preventDefault();
  if (!state.connected) return;
  // The gesture list stays up permanently. It used to fade out on first touch
  // and never come back, which meant the one moment you needed reminding —
  // mid-session, reaching for a gesture you use rarely — was the one moment it
  // was not there. The lit border is enough to show the pad is live.
  pad.classList.add('live');


  const n = e.touches.length;
  const c = centroid(e.touches);
  const now = performance.now();
  g.maxFingers = Math.max(g.maxFingers, n);

  // Per-finger origins: the difference between "both fingers moved" and "one
  // rested while the other slid" is the whole distinction between a scroll and
  // a drag-select, and a centroid cannot tell them apart.
  for (const t of e.touches) {
    if (!g.starts.has(t.identifier)) {
      g.starts.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
  }

  if (n === 1) {
    g.armedDouble = now - lastTapT < DOUBLE_MS &&
      Math.hypot(c.x - lastTapX, c.y - lastTapY) < DOUBLE_SLOP;
    g.mode = 'move';
    g.startT = now; g.moved = false;
    g.startX = c.x; g.startY = c.y;
  } else if (n === 2) {
    g.mode = 'scroll';
    g.startSpread = spreadOf(e.touches);
    g.lastSpread = g.startSpread;
    g.pinching = false; g.pinchBank = 0;
  } else {
    // Three or more: a swipe, decided when the fingers lift.
    g.mode = 'swipe';
    g.swipeX = 0; g.swipeY = 0;
    g.startSpread = spreadOf(e.touches);
    g.lastSpread = g.startSpread;
    g.pinching = false; g.fired = false;
  }
  g.lastX = c.x; g.lastY = c.y; g.lastT = now;
}, { passive: false });

pad.addEventListener('touchmove', (e) => {
  // A touch that starts on one of the pad's own buttons belongs to the button.
  // The preventDefault below is what stops iOS scrolling the page, and it also
  // cancels the synthesised click on anything nested inside — which is exactly
  // why tapping the air-pointer button did nothing on a phone.
  if (e.target.closest && e.target.closest('.pad-btn')) return;
  e.preventDefault();
  if (!state.connected || !state.cfg) return;

  const n = e.touches.length;
  const c = centroid(e.touches);
  const now = performance.now();
  const dx = c.x - g.lastX, dy = c.y - g.lastY;
  const dt = Math.max(now - g.lastT, 1);
  g.lastX = c.x; g.lastY = c.y; g.lastT = now;

  if (!g.moved && Math.hypot(c.x - g.startX, c.y - g.startY) > TAP_SLOP) g.moved = true;

  // ── two fingers: pinch beats scroll when the spread changes more ──
  // ── rest one finger, slide the other: hold the left button and drag ──
  if (n === 2 && !g.pinching) {
    const list = [...e.touches];
    const travel = list.map((t) => {
      const st = g.starts.get(t.identifier);
      return st ? Math.hypot(t.clientX - st.x, t.clientY - st.y) : 0;
    });
    const restingIdx = travel.findIndex((d) => d < REST_SLOP);
    const slidingIdx = travel.findIndex((d) => d > REST_SLOP * 1.6);

    if (!g.dragSelect && restingIdx !== -1 && slidingIdx !== -1 && restingIdx !== slidingIdx) {
      g.dragSelect = true;
      g.mode = 'dragselect';
      g.dragId = list[slidingIdx].identifier;
      const t = list[slidingIdx];
      g.dragLast = { x: t.clientX, y: t.clientY };
      mouseDown('left');
    }

    // Ambiguous until both fingers have committed: if one is still resting,
    // this may be about to become a drag-select, and scrolling first would
    // send the page flying before the drag even starts.
    if (!g.dragSelect && restingIdx !== -1) return;

    if (g.dragSelect) {
      const t = list.find((x) => x.identifier === g.dragId) || list[slidingIdx] || list[0];
      if (t && g.dragLast) {
        const ddx = t.clientX - g.dragLast.x;
        const ddy = t.clientY - g.dragLast.y;
        g.dragLast = { x: t.clientX, y: t.clientY };
        const p = state.cfg.pointer;
        const speed = Math.hypot(ddx, ddy) / dt;
        const gain = p.sensitivity * (1 + p.acceleration * Math.min(speed / 1.5, 3));
        sendMove(ddx * gain, ddy * gain);
      }
      return;
    }
  }

  if (g.mode === 'scroll' && n === 2) {
    const spread = spreadOf(e.touches);

    // Once this is a pinch it stays a pinch until the fingers lift, and it
    // keeps zooming for as long as they keep spreading. Banking the *change
    // since the last step* rather than the distance from the start is what
    // lets a long slow pinch keep going instead of firing once and stopping.
    if (!g.pinching && Math.abs(spread - g.startSpread) > PINCH_MIN) {
      g.pinching = true;
      g.pinchBank = 0;
      g.lastSpread = spread;
    }

    if (g.pinching) {
      g.pinchBank += spread - g.lastSpread;
      g.lastSpread = spread;
      while (Math.abs(g.pinchBank) >= ZOOM_STEP) {
        const zoomingIn = g.pinchBank > 0;
        if (!fireRepeat(zoomingIn ? gestureSet().zoomIn : gestureSet().zoomOut,
                        ZOOM_REPEAT_MS)) break;
        g.pinchBank -= zoomingIn ? ZOOM_STEP : -ZOOM_STEP;
      }
      return;                                    // never scroll mid-pinch
    }

    g.lastSpread = spread;
    const p = state.cfg.pointer;
    const dir = p.naturalScroll ? 1 : -1;
    sendScroll(dx * p.scrollSpeed * dir, dy * p.scrollSpeed * dir);
    return;
  }

  // ── three or more: accumulate travel, resolve on lift ──
  if (g.mode === 'swipe' && n >= 3) {
    g.swipeX += dx; g.swipeY += dy;
    g.spread = spreadOf(e.touches);

    // Keep going and it keeps switching: travel another SWIPE_STEP and the
    // next Space arrives, rather than having to lift and swipe again.
    const set = gestureSet()[Math.min(n, 4)] || gestureSet()[3];
    const horizontal = Math.abs(g.swipeX) > Math.abs(g.swipeY);
    const travelled = horizontal ? g.swipeX : g.swipeY;
    if (Math.abs(travelled) >= SWIPE_STEP) {
      const dir = horizontal ? (g.swipeX > 0 ? 'right' : 'left')
                             : (g.swipeY > 0 ? 'down' : 'up');
      if (fireRepeat(set[dir], SWIPE_REPEAT_MS)) {
        g.swipeX = 0; g.swipeY = 0;
        g.fired = true;
      }
    }
    return;
  }

  if (g.mode === 'move' || g.mode === 'drag') {
    if (g.armedDouble && !g.dragging && g.moved) {
      g.dragging = true; g.mode = 'drag'; mouseDown('left');
    }
    const p = state.cfg.pointer;
    // Speed-based gain: slow movement stays precise, a flick crosses the
    // screen. This is what a MacBook trackpad actually varies.
    const speed = Math.hypot(dx, dy) / dt;              // px per ms
    const gain = p.sensitivity * (1 + p.acceleration * Math.min(speed / 1.5, 3));
    // While pointing, aiming the phone moves the cursor — so a finger drag
    // must not also move it. Letting both drive at once fights itself.
    if (!air.on) sendMove(dx * gain, dy * gain);
  }
}, { passive: false });

function endGesture(e) {
  e.preventDefault();
  if (!state.connected) return;

  if (e.touches.length > 0) {
    // Re-seat so lifting one finger of several doesn't fling the cursor.
    const c = centroid(e.touches);
    g.lastX = c.x; g.lastY = c.y;
    if (e.touches.length === 1 && g.mode !== 'swipe') {
      g.mode = g.dragging ? 'drag' : 'move';
    }
    return;
  }
  pad.classList.remove('live');

  const now = performance.now();
  const dur = now - g.startT;
  const fingers = g.maxFingers;

  if (g.dragSelect) {
    mouseUp('left');
    g.dragSelect = false;

  } else if (g.dragging) {
    mouseUp('left');
    g.dragging = false;

  } else if (g.mode === 'swipe' && fingers >= 3) {
    const set = gestureSet()[Math.min(fingers, 4)] || gestureSet()[3];
    const dSpread = g.spread - g.startSpread;

    if (fingers >= 4 && Math.abs(dSpread) > PINCH_MIN) {
      fireCombo(dSpread < 0 ? gestureSet().pinchIn : gestureSet().pinchOut,
                dSpread < 0 ? 'Launchpad' : 'Show Desktop');
    } else if (g.fired) {
      // Already handled mid-gesture; a short tail should not fire again.
    } else if (Math.abs(g.swipeX) > SWIPE_MIN || Math.abs(g.swipeY) > SWIPE_MIN) {
      const horizontal = Math.abs(g.swipeX) > Math.abs(g.swipeY);
      const dir = horizontal ? (g.swipeX > 0 ? 'right' : 'left')
                             : (g.swipeY > 0 ? 'down' : 'up');
      fireCombo(set[dir], `${fingers} fingers ${dir}`);
    } else if (!g.moved && dur < TAP_MS) {
      sendClick('middle');                        // 3-finger tap
    }

  } else if (!g.moved && dur < TAP_MS && state.cfg?.pointer.tapToClick) {
    if (fingers === 1) {
      const isDouble = now - lastTapT < DOUBLE_MS &&
        Math.hypot(g.startX - lastTapX, g.startY - lastTapY) < DOUBLE_SLOP;
      sendClick('left', isDouble ? 2 : 1);
      lastTapT = isDouble ? 0 : now;              // don't chain into a triple
      lastTapX = g.startX; lastTapY = g.startY;
    } else if (fingers === 2) {
      sendClick('right');
    }
  }

  g.mode = 'idle';
  g.maxFingers = 0;
  g.armedDouble = false;
  g.swipeX = 0; g.swipeY = 0;
  g.pinching = false; g.pinchBank = 0; g.fired = false;
  g.dragSelect = false; g.dragId = null; g.dragLast = null;
  g.starts.clear();
  accX = accY = accSX = accSY = 0;
}

pad.addEventListener('touchend', endGesture, { passive: false });
pad.addEventListener('touchcancel', endGesture, { passive: false });

// ─── Sticky modifiers + keyboard passthrough ──────────────────────────────
// Tap ⌘ then type "c" to send Cmd+C. Modifiers clear after one key, which is
// what "sticky" means everywhere else in macOS.

const sticky = new Set();

function renderModStrip() {
  const strip = $('modstrip');
  strip.innerHTML = '';
  // The sticky ⌘/⌥/⌃/⇧ buttons are gone: the on-screen keyboard carries its
  // own modifiers, so these were a second way to do the same thing.
  const kb = el('button', 'sticky wide', '⌨︎ Keyboard');
  kb.id = 'kbtoggle';
  kb.addEventListener('click', openLiveKeyboard);
  strip.appendChild(kb);
}

function clearSticky() {
  sticky.clear();
  for (const b of document.querySelectorAll('.sticky[data-mod]')) b.setAttribute('aria-pressed', 'false');
}

// ─── Air pointer (gyroscope) ──────────────────────────────────────────────
// Point the phone at the screen and the cursor follows, like a presentation
// remote. Two things make it usable rather than a novelty:
//
//   · Latched, not held. One tap of ✥ turns it on and it stays on; you should
//     not have to keep a finger down to point at something.
//   · A dead-band. Integrating angular velocity is what makes a gyro pointer
//     drift, and a phone reports a small non-zero rate even lying still. Below
//     the threshold the phone counts as stationary, which is what stops the
//     cursor walking off on its own now that nothing re-anchors it.
//   · Screen-orientation-aware axes. rotationRate is reported about the
//     *device's* axes, which rotate when the screen does, so pitch and yaw
//     swap between portrait and landscape unless you rotate them back.
//
// iOS will not deliver motion events at all unless the page is a secure
// context AND the user has granted permission from a real tap — hence
// HTTPS by default (see bin/connect) and the explicit request below.

const air = { on: false, holding: false, listening: false, last: 0 };

// Measured on this device, because the channel each motion arrives on cannot
// be predicted. Defaults match what the author's iPhone actually reported, so
// an uncalibrated device is closer than a spec-derived guess would be.
const AIR_CAL_KEY = 'mnd.aircal';
const AIR_CAL_DEFAULT = { v: { axis: 'alpha', sign: -1 }, h: { axis: 'gamma', sign: 1 } };
let airCal = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(AIR_CAL_KEY) || 'null');
    if (v && v.v && v.h) return v;
  } catch { /* fall through */ }
  return structuredClone(AIR_CAL_DEFAULT);
})();

/** Watch the gyro for a moment and report which channel moved most, and which
 *  way. That is all calibration needs: one motion, one dominant axis. */
function captureAxis(ms = 1400, exclude = null) {
  return new Promise((resolve) => {
    const sum = { alpha: 0, beta: 0, gamma: 0 };
    const onTick = (e) => {
      const r = e.rotationRate;
      if (!r) return;
      sum.alpha += r.alpha || 0;
      sum.beta += r.beta || 0;
      sum.gamma += r.gamma || 0;
    };
    addEventListener('devicemotion', onTick);
    setTimeout(() => {
      removeEventListener('devicemotion', onTick);
      const axes = ['alpha', 'beta', 'gamma'].filter((a) => a !== exclude);
      let best = axes[0];
      for (const a of axes) if (Math.abs(sum[a]) > Math.abs(sum[best])) best = a;
      resolve({ axis: best, total: sum[best], moved: Math.abs(sum[best]) > 40 });
    }, ms);
  });
}

const airSupported = () =>
  typeof DeviceMotionEvent !== 'undefined' && window.isSecureContext;

function onMotion(e) {
  if (!air.on || !live()) return;
  const r = e.rotationRate;
  if (!r) return;

  const now = performance.now();
  // Cap dt so a stall (backgrounded tab, dropped frame) cannot integrate into
  // one enormous jump when the events resume.
  const dt = Math.min((now - air.last) / 1000, 0.05);
  air.last = now;
  if (dt <= 0) return;

  // Which physical motion lands on which channel is NOT reliable across
  // devices and iOS versions — the spec says alpha/beta/gamma are Z/X/Y, and
  // the hardware disagreed on the phone this was built for: tilting the front
  // edge up arrived on `alpha` and rolling arrived on `beta`. Guessing cost
  // two rounds of "it moves the wrong way", so the mapping is measured on the
  // device instead of assumed, by the calibration in the posture gate.
  const rate = { alpha: r.alpha || 0, beta: r.beta || 0, gamma: r.gamma || 0 };
  const sx = rate[airCal.h.axis] * airCal.h.sign;   // horizontal: swivel
  const sy = rate[airCal.v.axis] * airCal.v.sign;   // vertical: tilt
  // Dead-band. A gyroscope reports a slow non-zero rate even when the phone is
  // flat on a table, and integrating that noise walks the cursor across the
  // screen on its own. Below this the phone is treated as still — which is
  // what makes a latched mode usable at all.
  if (Math.abs(sx) < 1.2 && Math.abs(sy) < 1.2) return;

  const p = state.cfg?.pointer || {};
  const k = (p.airSpeed ?? 25) * dt;          // pixels per degree, per tick
  const flip = p.airInvert ? -1 : 1;
  // Signs already come from calibration, so no negation here.
  sendMove(sx * k, sy * k * flip);
}

function applyAir() {
  document.body.dataset.air = air.on ? '1' : '0';
  // The pointer screen replaces the whole app, so anything transient behind it
  // must be dismissed — a sheet left open would still be there on the way out.
  if (air.on) {
    for (const sh of document.querySelectorAll('.sheet')) sh.hidden = true;
    closeBoardMenu();
  }
  const b = $('airbtn');
  if (b) {
    b.setAttribute('aria-pressed', air.on ? 'true' : 'false');
    b.title = air.on ? 'Air pointer on — hold the pad and aim' : 'Air pointer (gyroscope)';
  }
  padHint();
}

/** Which way the gate is facing. */
let airHowMode = 'start';

/**
 * How the phone is actually being held, from gravity.
 *
 * `matchMedia('(orientation: …)')` is the obvious tool and the wrong one here:
 * held FLAT, gravity points along Z and iOS reports portrait or landscape more
 * or less arbitrarily. That is exactly the posture this feature uses, so the
 * media query can say "landscape" about a phone lying on your palm — and the
 * turn-it-sideways prompt, which is keyed off that query, never appears.
 *
 * Gravity does not have that problem: whichever axis carries ~9.8 says which
 * way is down, and that distinguishes flat from upright as well as portrait
 * from landscape.
 */
function posture(g) {
  if (!g) return null;
  const ax = Math.abs(g.x || 0), ay = Math.abs(g.y || 0), az = Math.abs(g.z || 0);
  if (az >= ax && az >= ay) return 'flat';
  return ay >= ax ? 'portrait' : 'landscape';
}

/**
 * Resolve once the phone is genuinely held that way, held steadily for a beat
 * so a wobble on the way past does not count.
 *
 * `onFallback` fires if gravity never arrives — permission refused, a browser
 * without motion, a desktop. Nobody gets stuck on a screen waiting for a
 * sensor that is never going to report.
 */
function waitForPosture(want, onFallback) {
  return new Promise((resolve) => {
    let heldSince = 0;
    let sawAny = false;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      removeEventListener('devicemotion', onTick);
      clearTimeout(fallbackTimer);
      resolve();
    };

    const onTick = (e) => {
      const g = e.accelerationIncludingGravity;
      if (!g || (g.x == null && g.y == null && g.z == null)) return;
      sawAny = true;
      if (posture(g) === want) {
        if (!heldSince) heldSince = performance.now();
        else if (performance.now() - heldSince > 350) finish();
      } else {
        heldSince = 0;
      }
    };

    addEventListener('devicemotion', onTick);

    // No gravity after a fair wait: offer a way through instead of trapping.
    const fallbackTimer = setTimeout(() => {
      if (done) return;
      if (!sawAny && onFallback) onFallback(finish);
      else if (!sawAny) finish();
    }, 2500);
  });
}

const AIR_COPY = {
  calV: {
    ico: '⬆',
    h: 'Step 1 of 2 — tilt UP',
    p: 'Keep the phone flat. When you tap Start, slowly tilt the FAR edge '
     + '(the camera end) UP and hold it there until this closes.\n\n'
     + 'This is measuring which sensor your phone puts that motion on — it '
     + 'is not the same on every device.',
    go: 'Start',
  },
  calH: {
    ico: '➡',
    h: 'Step 2 of 2 — swivel RIGHT',
    p: 'Back to flat. When you tap Start, swivel the phone so the FAR edge '
     + 'swings to your RIGHT — like turning to look right — and hold it '
     + 'until this closes.',
    go: 'Start',
  },
  calDone: {
    ico: '✓',
    h: 'Calibrated',
    p: '',
    go: 'Start pointing',
  },
  start: {
    ico: '📱',
    h: 'Hold it like a remote',
    p: 'Lay the phone FLAT on your palm — screen facing up, back camera facing '
     + 'down, charging port toward you and the camera edge pointing away.\n\n'
     + 'First time here? Tap Calibrate. It measures which sensor your phone '
     + 'puts each motion on, which is not the same on every device — two '
     + 'movements, about five seconds, and it is remembered afterwards.\n\n'
     + 'Then, before you start: move the cursor to the MIDDLE of your Mac\u2019s '
     + 'screen, aim the phone at that spot, and tap Start pointing. Aiming and '
     + 'the cursor line up from wherever they both are at that moment, so '
     + 'starting from the centre gives you room to move in every direction.\n\n'
     + 'After that: tilt the far edge up and down to move the cursor up and '
     + 'down, and swivel left and right to move it across.',
    go: 'Start pointing',
  },
  // Which way you are asked to hold it on the way out depends entirely on the
  // layout you are returning to. This screen used to say "sideways" always,
  // which was written when the phone layout was landscape — on a portrait
  // phone it was telling you to turn away from the orientation it needs.
  sideways: {
    ico: '⟳',
    h: 'Turn the phone sideways',
    p: 'Pointing is off. Stand the phone up and turn it sideways for the '
     + 'trackpad, the deck and the keyboard.\n\n'
     + 'This clears itself as soon as you do.',
    go: '',
  },
  standUp: {
    ico: '📱',
    h: 'Hold the phone upright',
    p: 'Pointing is off. Stand the phone up, portrait, for the trackpad, the '
     + 'deck and the keyboard.\n\n'
     + 'This clears itself as soon as you do.',
    go: '',
  },
  upright: {
    ico: '📱',
    h: 'Hold the phone upright',
    p: 'Portrait, the tall way up — the same way you would read a message.\n\n'
     + 'This screen moves on by itself as soon as you do.',
    go: '',
  },
};

function showAirHow(mode) {
  airHowMode = mode;
  const c = AIR_COPY[mode];
  $('airhow-ico').textContent = c.ico;
  $('airhow-h').textContent = c.h;
  $('airhow-p').textContent = c.p;
  $('airhow-go').textContent = c.go;
  // The diagram only makes sense for the posture, not for going back.
  $('airhow-diagram').hidden = mode !== 'start';
  $('airhow-cancel').hidden = !(mode === 'start' || mode.startsWith('cal'));
  $('airhow-recal').hidden = mode !== 'start';
  // The upright step waits for the phone, not for a tap. A button there would
  // just be a second thing to do for something already being measured.
  const waiting = mode === 'upright' || mode === 'sideways' || mode === 'standUp';
  $('airhow-go').hidden = waiting;
  $('airhow-ico').classList.toggle('spin', waiting);
  $('airhow').hidden = false;
}

$('airhow-cancel').addEventListener('click', () => {
  $('airhow').hidden = true;
  airCalibrating = false;
});

$('airhow-recal').addEventListener('click', () => { runCalibration(); });

let airCalibrating = false;

/** Two motions, two measurements. Far more reliable than reasoning about which
 *  axis is which, and it takes about five seconds. */
async function runCalibration() {
  airCalibrating = true;
  if (!air.listening) { addEventListener('devicemotion', onMotion); air.listening = true; }

  showAirHow('calV');
  await waitForGo();
  if (!airCalibrating) return;
  $('airhow-h').textContent = 'Tilt the far edge UP…';
  $('airhow-go').disabled = true;
  const v = await captureAxis(1400);
  $('airhow-go').disabled = false;
  if (!v.moved) {
    $('airhow-p').textContent = 'I did not feel any movement. Make sure motion '
      + 'access is allowed, then try again.';
    return;
  }
  // Tilting up must send the cursor up, and screen Y grows downward.
  airCal.v = { axis: v.axis, sign: -Math.sign(v.total) };

  showAirHow('calH');
  await waitForGo();
  if (!airCalibrating) return;
  $('airhow-h').textContent = 'Swivel the far edge RIGHT…';
  $('airhow-go').disabled = true;
  const h = await captureAxis(1400, v.axis);
  $('airhow-go').disabled = false;
  if (!h.moved) {
    $('airhow-p').textContent = 'I did not feel any movement there. Try again.';
    return;
  }
  airCal.h = { axis: h.axis, sign: Math.sign(h.total) };

  localStorage.setItem(AIR_CAL_KEY, JSON.stringify(airCal));
  airCalibrating = false;
  showAirHow('calDone');
  $('airhow-p').textContent =
    `Up and down is your phone's "${airCal.v.axis}" sensor, left and right is `
    + `"${airCal.h.axis}". Saved for this device — you will not be asked again.`;
}

/** Resolve when the gate's primary button is next pressed. */
function waitForGo() {
  return new Promise((resolve) => {
    const b = $('airhow-go');
    const once = () => { b.removeEventListener('click', once); resolve(); };
    b.addEventListener('click', once);
  });
}

$('airhow-go').addEventListener('click', () => {
  // Calibration drives the button itself via waitForGo(); do not also treat
  // the press as "begin pointing".
  if (airCalibrating) return;
  $('airhow').hidden = true;
  if (!air.listening) { addEventListener('devicemotion', onMotion); air.listening = true; }
  air.on = true;
  air.last = performance.now();
  applyAir();
  toast('Pointing — aim the phone, ● to click');
});

async function toggleAir() {
  // Exiting is one tap, not two. Pointing stops immediately and the app's own
  // "Turn your device sideways" screen — which already exists, animation and
  // all, and already waits for the phone rather than for a tap — takes over
  // while the phone is still portrait. Adding a confirmation on top of it was
  // asking twice for the same thing.
  if (air.on) {
    air.on = false;
    applyAir();
    // Do not lean on the CSS rotate prompt here: it is keyed off the
    // orientation media query, which cannot see that the phone is flat, so it
    // may simply never appear. Ask explicitly and watch gravity instead.
    // The phone layout is portrait and the iPad layout is landscape, so ask
    // for whichever one you are going back to.
    const wantPortrait = isMobile();
    showAirHow(wantPortrait ? 'standUp' : 'sideways');
    await waitForPosture(wantPortrait ? 'portrait' : 'landscape', (skip) => {
      $('airhow-p').textContent = wantPortrait
        ? 'Stand the phone upright to carry on.'
        : 'Turn the phone sideways to carry on.';
      $('airhow-go').textContent = 'Continue';
      $('airhow-go').hidden = false;
      $('airhow-go').addEventListener('click', skip, { once: true });
    });
    $('airhow').hidden = true;
    return;
  }

  if (!airSupported()) {
    showFailure('Air pointer',
      'The gyroscope is only offered to a page served over HTTPS — iOS refuses '
      + 'it to anything else, and this page came over plain http. That happens '
      + 'if the server was started with  connect --plain. Stop it and run '
      + 'just  connect,  which serves HTTPS, then reopen the link it prints. '
      + 'Your phone warns you once about the certificate: tap Show Details, '
      + 'then "visit this website".');
    return;
  }

  // iOS 13+ only grants this from inside a real tap, which is why this runs
  // straight off the click rather than at startup.
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    let res;
    try { res = await DeviceMotionEvent.requestPermission(); }
    catch (err) {
      showFailure('Air pointer', `The motion permission request failed: ${err.message || err}`);
      return;
    }
    if (res !== 'granted') {
      toast('Motion access denied — allow it in Settings › Safari');
      return;
    }
  }

  // Permission is granted. Now the posture, in two steps: get the phone
  // upright (which the device can actually detect), then lay it flat like a
  // remote (which it cannot — flat reads as neither portrait nor landscape,
  // because gravity is along Z and there is nothing left to resolve it with).
  showAirHow('upright');
  await waitForPosture('portrait', (skip) => {
    // Gravity never turned up. Say so and let them carry on by hand rather
    // than staring at a screen that will never advance.
    $('airhow-p').textContent =
      'I cannot read this device\u2019s motion sensor, so I cannot tell how you '
      + 'are holding it. Hold the phone upright, then continue.';
    $('airhow-go').textContent = 'Continue';
    $('airhow-go').hidden = false;
    $('airhow-go').addEventListener('click', skip, { once: true });
  });
  if ($('airhow').hidden) return;        // cancelled while we waited
  showAirHow('start');
}

/** The trackpad's permanent legend, which changes with the mode. */
function padHint() {
  const h = $('padhint');
  if (!h) return;
  const lines = air.on
    ? ['pointing · phone flat, port toward you, camera away',
       'tilt the far edge up/down · swivel left/right',
       'use ● and ◐ to click · ✥ turns it off']
    : ['drag to move · tap to click · two-finger tap right-clicks',
       'rest one finger and slide another to click-and-drag',
       'two fingers scroll or pinch · three fingers swipe between spaces'];
  h.innerHTML = '';
  for (const l of lines) h.appendChild(el('span', null, l));
}

const isMobile = () => state.layout === 'mobile';

// ─── What is showing ──────────────────────────────────────────────────────
// Deck and Pad are independent toggles, so "both" is simply both being on.
// Keys is not a third member of that set: it borrows the whole stage and gives
// back exactly what was there before, which is why the previous selection is
// stashed rather than recomputed.
//
// On a phone the two are mutually exclusive — a landscape phone is ~390px tall
// and splitting it gives you two unusable halves. Same code path, one extra
// rule.

function applyPanes() {
  const b = document.body;
  b.dataset.keys = state.keysOnly ? '1' : '0';
  b.dataset.show = state.show.board && state.show.pad ? 'both'
                 : state.show.board ? 'board' : 'pad';

  // While the keyboard has the stage, only Keys is lit. state.show still holds
  // what to restore, but showing it as lit would claim a pane is on screen
  // when it plainly is not.
  const on = state.keysOnly
    ? { board: false, pad: false, keys: true }
    : { board: state.show.board, pad: state.show.pad, keys: false };
  for (const t of document.querySelectorAll('.pane-tab')) {
    t.setAttribute('aria-pressed', on[t.dataset.pane] ? 'true' : 'false');
  }
  if (state.keysOnly) renderInlineKeyboard();
  // The board's row count depends on the width it just gained or lost.
  fitBoard();
}

const saveShow = () => localStorage.setItem('mnd.show', JSON.stringify(state.show));

/** Put the keyboard away, restoring whatever it covered. */
function leaveKeys() {
  if (!state.keysOnly) return;
  if (state.showBeforeKeys) state.show = state.showBeforeKeys;
  state.showBeforeKeys = null;
  state.keysOnly = false;
}

function togglePane(which) {
  if (which === 'keys') {
    if (state.keysOnly) leaveKeys();
    else { state.showBeforeKeys = { ...state.show }; state.keysOnly = true; }
    applyPanes();
    return;
  }

  // Leaving the keyboard by pressing Deck or Pad restores what the keyboard
  // was covering AND guarantees the pane you actually pressed is one of them.
  //
  // Restoring alone was wrong and looked like a swap: if the keyboard had
  // covered a pad-only view, pressing Deck put the pad back and the deck was
  // nowhere — pressing Deck appeared to show the Pad. Never toggled off here
  // either; the press means "show me this", not "flip this".
  if (state.keysOnly) {
    leaveKeys();
    state.show[which] = true;
    if (isMobile()) state.show[which === 'board' ? 'pad' : 'board'] = false;
    saveShow();
    applyPanes();
    return;
  }

  const other = which === 'board' ? 'pad' : 'board';
  if (state.show[which]) {
    // Turning off the only thing on screen would leave a blank stage, so the
    // other one comes up in its place.
    state.show[other] = true;
    state.show[which] = false;
  } else {
    state.show[which] = true;
    // A phone has no room for both at once.
    if (isMobile()) state.show[other] = false;
  }
  saveShow();
  applyPanes();
}

for (const t of document.querySelectorAll('.pane-tab')) {
  t.addEventListener('click', () => togglePane(t.dataset.pane));
}

// ─── Interface scale ──────────────────────────────────────────────────────
// Stored on the device rather than on the host, and separately per layout: an
// iPad and a phone want very different sizes, and one device can be switched
// between the two. Same reasoning as the layout choice itself.

const UI_MIN = 50, UI_MAX = 150, UI_STEP = 5;   // percent
const zoomKey = () => `mnd.zoom.${state.layout}`;
let zoom = 100;
// True while the size is still the one we picked. A size you chose yourself is
// never quietly moved underneath you; an automatic one is free to correct.
let zoomAuto = true;

const snapUI = (pct) => Math.min(UI_MAX, Math.max(UI_MIN,
  Math.round(pct / UI_STEP) * UI_STEP));

/** Everything the fit maths needs, at 100%, matching the two blocks in
 *  style.css. `full` is the height icon + label + shortcut actually occupy and
 *  `lean` the same without the shortcut line — both below `tile`, so a row at
 *  its floor always has room for all three. */
const zoomBase = () => (isMobile()
  ? { tile: 76, gap: 8,  full: 68, lean: 54 }
  : { tile: 84, gap: 12, full: 80, lean: 64 });

const rowsNeeded = () => {
  const grid = $('grid');
  const cols = Number(getComputedStyle(grid).getPropertyValue('--cols')) || 4;
  return Math.max(1, Math.ceil(grid.children.length / cols));
};

/** Height the board has to work with. On a phone only one pane is displayed,
 *  so #grid measures 0 while you are on the trackpad — estimate from the stage
 *  in that case, and let fitBoard correct it once the deck is really shown. */
function boardHeight() {
  const h = $('grid').clientHeight;
  if (h) return h;
  const stage = $('stage'), cs = getComputedStyle(stage);
  const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const HEAD = 40, GAP = 12;       // #boardhead height + #boardcol gap
  return Math.max(0, stage.clientHeight - pad - HEAD - GAP);
}

/** The largest 5% step at which the whole board is still on screen.
 *
 *  Capped at 100% on purpose. Rows are 1fr, so on a tall screen they already
 *  stretch to fill the column — scaling past 100% would not add tiles or
 *  height, it would only inflate a 26px icon to 39px inside a tile that is
 *  still 80px wide, and truncate every label to make room. Fitting means
 *  "all of it visible", so it shrinks when a screen is short and otherwise
 *  leaves the design alone. Going bigger than that is what the + button is
 *  for. */
function fitZoom() {
  const avail = boardHeight();
  if (!avail) return zoom;
  const rows = rowsNeeded();
  const { tile, gap } = zoomBase();
  const need = rows * tile + (rows - 1) * gap;
  // Round *down* to a step: a fit that overshoots by 4% still scrolls.
  return Math.min(100, Math.max(UI_MIN,
    Math.floor((avail / need) * 100 / UI_STEP) * UI_STEP));
}

let refitting = false;

/** Row count is exact, so the rows stretch to fill the column rather than
 *  leaving dead space under the last one. Then drop a line of tile text if the
 *  row is too short to hold it. */
function fitBoard() {
  const grid = $('grid');
  const rows = rowsNeeded();
  grid.style.setProperty('--rows', rows);

  // The moment the deck is genuinely on screen, re-derive an automatic size
  // from the real measurement — the estimate used before that has to guess at
  // the padding and header around it, and being 2px out still scrolls.
  if (zoomAuto && !refitting && grid.clientHeight) {
    const want = fitZoom();
    if (want !== zoom) {
      refitting = true;
      setZoom(want, { save: false, auto: true });
      refitting = false;
      return;                       // setZoom re-entered and finished the job
    }
  }

  // Belt and braces: the row floor is already above `full`, so these should
  // never fire — but if a board ever does get squeezed, losing the shortcut
  // line beats clipping it.
  const { gap, full, lean } = zoomBase();
  const rowH = (boardHeight() - (rows - 1) * gap * zoom / 100) / rows;
  grid.classList.toggle('tight', rowH < full * zoom / 100);
  grid.classList.toggle('tiny', rowH < lean * zoom / 100);
}

function setZoom(pct, { save = true, announce = false, auto = false } = {}) {
  zoom = snapUI(pct);
  zoomAuto = auto;
  document.documentElement.style.setProperty('--ui', (zoom / 100).toFixed(2));
  if (save) localStorage.setItem(zoomKey(), zoom);
  fitBoard();
  syncZoom();
  if (announce) toast(`Interface ${zoom}%`);
}

/** First run on a given layout fits automatically — "everything on screen" is
 *  the right default, and the 5% steps are there to disagree with it. */
function initZoom() {
  const saved = Number(localStorage.getItem(zoomKey()));
  const known = saved >= UI_MIN && saved <= UI_MAX;
  setZoom(known ? saved : fitZoom(), { save: false, auto: !known });
}

function syncZoom() {
  const out = $('out-zoom');
  if (!out) return;
  out.textContent = `${zoom}%`;
  $('zoom').value = zoom;
  $('zoom-out').disabled = zoom <= UI_MIN;
  $('zoom-in').disabled = zoom >= UI_MAX;
}

$('zoom').addEventListener('input', () => setZoom(Number($('zoom').value)));
$('zoom-out').addEventListener('click', () => setZoom(zoom - UI_STEP));
$('zoom-in').addEventListener('click', () => setZoom(zoom + UI_STEP));
// Fit stays "automatic", so it keeps tracking a rotation or a board edit.
$('zoom-fit').addEventListener('click', () =>
  setZoom(fitZoom(), { announce: true, auto: true }));

// Rotating, or an iPad window being resized, changes what fits.
addEventListener('resize', fitBoard);

/** Re-check the layout when the screen itself changes.
 *
 *  Detection used to run once, at load. That is right for a phone, which never
 *  changes size — but an iPad in Split View or Stage Manager does, and a
 *  stale verdict there means the wrong layout with no way to correct it now
 *  that the manual switch is gone. */
function recheckLayout() {
  const want = detectLayout();
  if (want === state.layout) return;
  state.layout = want;
  state.show = want === 'mobile'
    ? { board: false, pad: true }     // a phone cannot show both
    : { board: true, pad: true };
  state.keysOnly = false;
  state.showBeforeKeys = null;
  saveShow();
  applyPlatform();
  initZoom();
}
addEventListener('resize', recheckLayout);
addEventListener('orientationchange', recheckLayout);

/** Repaint everything whose wording depends on the platform or layout. */
function applyPlatform() {
  document.body.dataset.platform = state.platform;
  document.body.dataset.layout = state.layout;
  document.body.dataset.lefty = state.lefty ? '1' : '0';
  applyPanes();
  // Each layout wants the opposite orientation, so the prompt has to as well:
  // the iPad needs the width, the phone needs the height.
  $('rotate-h').textContent = isMobile()
    ? 'Hold your phone upright'
    : 'Turn your device sideways';
  $('rotate-p').textContent = isMobile()
    ? 'The phone layout runs in portrait — the deck, the trackpad and the '
      + 'keyboard all want the height.'
    : 'The iPad layout needs landscape — the trackpad and board sit side by side.';
  // One header in every combination of style and layout — same buttons, same
  // wording. Only the state each button reports changes; what has to give on a
  // narrow screen is handled by width in the stylesheet, not by a second
  // header design here.
  renderModStrip();
  if (!$('livekb').hidden) renderLiveKeyboard();
  renderBoard();
}


// ─── Phone keyboard ───────────────────────────────────────────────────────
// A desktop layout has 14 keys per row. Across a 374px phone that is 22px per
// key — narrower than a fingertip, and the reason the inline keyboard was
// unusable. Every phone keyboard ever shipped solves this the same way: ten
// keys per row, and the numbers and symbols behind a toggle. So does this one.
//
// The shortcut PICKER still shows the full desktop layout, so nothing becomes
// unbindable — this is only the keyboard you type on.

let phoneSymbols = false;

// Numbers stay on the main layer rather than behind the toggle. A phone
// keyboard hides them because it is for prose; this one is for shortcuts, and
// ⌘1..⌘9 (tabs, Finder views, workspaces) are among the most-reached keys
// here. They fit at ten across, the same as QWERTY, so they cost one row.
const KB_PHONE_LETTERS = [
  [['1','1'],['2','2'],['3','3'],['4','4'],['5','5'],['6','6'],['7','7'],['8','8'],['9','9'],['0','0']],
  [['Q','q'],['W','w'],['E','e'],['R','r'],['T','t'],['Y','y'],['U','u'],['I','i'],['O','o'],['P','p']],
  [['A','a'],['S','s'],['D','d'],['F','f'],['G','g'],['H','h'],['J','j'],['K','k'],['L','l']],
  [['⇧','shift','w15'],['Z','z'],['X','x'],['C','c'],['V','v'],['B','b'],['N','n'],['M','m'],['⌫','delete','w15']],
];

// The second layer is punctuation and navigation — what is left once the
// numbers have moved to the front.
const KB_PHONE_SYMBOLS = [
  [['-','-'],['=','='],['[','['],[']',']'],['\\','\\'],[';',';'],["'","'"],['`','`'],['/','/'],[',',',']],
  [['.','.'],['esc','escape'],['⇥','tab'],['⌦','forwarddelete'],['⇞','pageup'],['⇟','pagedown'],['⤒','home'],['⤓','end']],
  [['⇧','shift','w15'],['↑','up'],['↓','down'],['←','left'],['→','right'],['⌫','delete','w15']],
];

/** The bottom row carries the modifiers, because a deck's keyboard is mostly
 *  used for chords rather than prose. */
const phoneBottom = () => [
  [phoneSymbols ? 'ABC' : '#+=', '__sym', 'w15'],
  ...(isWin()
    ? [['Ctrl','ctrl'],['Alt','alt'],['⊞','win']]
    : [['⌃','ctrl'],['⌥','alt'],['⌘','cmd']]),
  ['space', 'space', 'w25'],
  ['⏎', 'return', 'w15'],
];

const phoneRows = () => [
  ...(phoneSymbols ? KB_PHONE_SYMBOLS : KB_PHONE_LETTERS),
  phoneBottom(),
];

const MOD_HOLD_MS = 1500;

/** Press-and-hold to latch a modifier, with the key filling as it goes.
 *  A quick tap says what to do instead of doing nothing. */
function attachModHold(k, code) {
  let timer = null;
  let fired = false;

  const start = (e) => {
    e.preventDefault();
    fired = false;
    k.classList.add('holding', 'holding-long');
    timer = setTimeout(() => {
      fired = true;
      k.classList.remove('holding', 'holding-long');
      if (liveMods.has(code)) liveMods.delete(code); else liveMods.add(code);
      renderInlineKeyboard();
    }, MOD_HOLD_MS);
  };

  const cancel = () => {
    clearTimeout(timer);
    k.classList.remove('holding', 'holding-long');
  };

  k.addEventListener('pointerdown', start);
  k.addEventListener('pointerup', cancel);
  k.addEventListener('pointerleave', cancel);
  k.addEventListener('pointercancel', cancel);
  k.addEventListener('click', (e) => {
    e.preventDefault();
    if (!fired) toast(`Hold ${keyFace(code)} for a moment to latch it`);
  });
}

/** The same keyboard as the sheet, drawn inline as its own pane. */
function renderInlineKeyboard() {
  $('ik-note').textContent = (isWin() ? 'Windows layout' : 'macOS layout')
    + ' · hold a modifier, then tap a key';
  $('ik-preview').textContent = [...liveMods].map((m) => MODSYM[m] || m).join('') || '—';

  const wrap = $('ik-keys');
  wrap.innerHTML = '';
  // On a phone the function row is 13 keys across ~390px — 24px each, too
  // small to hit and the least-reached row there is. Dropping it makes every
  // remaining key bigger. The shortcut picker still offers F1-F12, so nothing
  // becomes unbindable.
  const rows = isMobile() ? phoneRows() : liveRows();
  for (const row of rows) {
    const r = el('div', 'krow');
    for (const [label, code, w] of row) {
      const k = el('button', 'key' + (w ? ' ' + w : ''), label);
      k.setAttribute('aria-label', code);
      const mod = MOD_KEYS.has(code);
      if (mod && liveMods.has(code)) k.setAttribute('aria-pressed', 'true');
      if (mod) {
        // Modifiers latch on a long press, not a tap. On a phone the modifier
        // row sits right under your thumb and a brush against ⌘ silently arms
        // it — so the next letter you type fires a shortcut instead. A hold
        // cannot happen by accident, and the key fills up while you wait so
        // it never looks like nothing is happening.
        attachModHold(k, code);
      } else {
        k.addEventListener('click', () => {
          if (code === '__sym') {
            phoneSymbols = !phoneSymbols;       // layer switch, sends nothing
          } else {
            sendJSON({ t: 'key', key: code, mods: [...liveMods] });
            liveMods.clear();
          }
          renderInlineKeyboard();
        });
      }
      r.appendChild(k);
    }
    wrap.appendChild(r);
  }
}

$('busy-take').addEventListener('click', () => {
  sendJSON({ t: 'takeover' });
});

// No layout or platform switch. Both are detected — the layout from this
// screen, the vocabulary from the machine that answered — and a button that
// can disagree with a measurement is a button that can only be wrong.

const kbinput = $('kbinput');

kbinput.addEventListener('keydown', (e) => {
  if (!state.connected) return;
  const mods = [...sticky];
  if (e.metaKey) mods.push('cmd');
  if (e.shiftKey) mods.push('shift');
  if (e.altKey) mods.push('alt');
  if (e.ctrlKey) mods.push('ctrl');

  const named = {
    Enter: 'return', Backspace: 'delete', Tab: 'tab', Escape: 'escape',
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  }[e.key];

  if (named) {
    e.preventDefault();
    sendJSON({ t: 'key', key: named, mods: [...new Set(mods)] });
    clearSticky();
  } else if (e.key.length === 1) {
    e.preventDefault();
    if (mods.length) sendJSON({ t: 'key', key: e.key.toLowerCase(), mods: [...new Set(mods)] });
    else sendJSON({ t: 'text', s: e.key });
    clearSticky();
  }
});

// ─── Board ────────────────────────────────────────────────────────────────

// Same action data, different vocabulary. macOS leans on glyphs; Windows
// users read words, and there is no ⌘ to borrow.
const MODSYM_MAC = { cmd: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃', fn: 'fn', win: '⊞' };
const MODSYM_WIN = { ctrl: 'Ctrl+', shift: 'Shift+', alt: 'Alt+', win: 'Win+', cmd: 'Ctrl+', fn: 'Fn+' };
const isWin = () => state.platform === 'windows';
const MODSYM = new Proxy({}, { get: (_, k) => (isWin() ? MODSYM_WIN : MODSYM_MAC)[k] });

/** Modifier keys the sticky strip and key picker offer, per platform. */
const MODKEYS = () => (isWin()
  ? [['ctrl', 'Ctrl'], ['alt', 'Alt'], ['win', '⊞ Win'], ['shift', 'Shift']]
  : [['cmd', '⌘'], ['alt', '⌥'], ['ctrl', '⌃'], ['shift', '⇧']]);

/** The catalog matching the current platform. */
const catalogNow = () => (isWin() ? (window.CATALOG_WINDOWS || []) : window.CATALOG);

const MEDIA_LABEL = {
  playpause: 'Play/Pause', next: 'Next track', prev: 'Prev track',
  soundup: 'Volume up', sounddown: 'Volume down', mute: 'Mute',
  brightnessup: 'Brightness up', brightnessdown: 'Brightness down',
};

/** Cut long text at the tile edge rather than letting it wrap or overflow. */
const ell = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** The program a shell command actually runs, skipping any leading VAR=value
 *  assignments. Used as the caption for a custom shell button, where there is
 *  no written one to fall back on. */
function progName(cmd) {
  for (const word of String(cmd || '').trim().split(/\s+/)) {
    if (!word || /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue;
    return word.split('/').pop();
  }
  return '';
}

/** What the tile prints under its label — the actual shortcut, written the way
 *  the connected platform writes it. */
function comboText(a, max = 18) {
  if (!a) return '';
  switch (a.type) {
    case 'key': {
      const mods = (a.mods || []).map((m) => MODSYM[m] || m).join('');
      return ell(mods + (a.key || '').toUpperCase(), max);
    }
    case 'media': return ell(MEDIA_LABEL[a.k] || a.k || 'media', max);
    // `~` is the home folder, but printed bare under a button it just looks
    // like a stray character.
    case 'open':  return ell(a.as || (a.target === '~' ? 'Home' : a.target) || 'open', max);
    // A shell line or an AppleScript body is not a shortcut, and its first 18
    // characters tell you nothing — `tell application "Fin…` under a button
    // already labelled Finder. Catalog entries carry a written caption in
    // `as`; anything else falls back to the command's own name, which at
    // least distinguishes one button from the next. Bare "command" on four
    // buttons in a row distinguishes nothing.
    case 'shell': return ell(a.as || progName(a.cmd) || 'command', max);
    case 'terminal': return ell(a.as || progName(a.cmd) || 'terminal', max);
    case 'applescript': return ell(a.as || 'script', max);
    case 'text':  return ell('"' + (a.s || '') + '"', max);
    case 'mouse': return `${a.b || 'left'} click${(a.n || 1) > 1 ? ` ×${a.n}` : ''}`;
    default: return a.type;
  }
}

const curPage = () => state.cfg?.board.pages[state.page];
/** Returns false if the Mac did not hear it — held for replay, not lost. */
const flushBoard = () => sendState({ t: 'setboard', board: state.cfg.board });

/** What to say after a save, given whether it actually reached the Mac. */
const savedToast = (ok) => toast(ok
  ? 'Board saved'
  : 'Saved here — the Mac is offline, it will sync when it reconnects');

/** Called by every edit. Outside edit mode it saves straight through; inside,
 *  it only marks the board dirty so Discard has something to roll back to. */
function saveBoard() {
  if (state.editing) { state.dirty = true; updateEditButtons(); return; }
  flushBoard();
}

function renderBoard() {
  if (!state.cfg) return;
  const grid = $('grid');
  // The phone used to cap this at four, from when the layout could be portrait
  // and a fifth column meant 60px tiles. In landscape the width is the
  // plentiful resource and the height is the scarce one, so a column the user
  // asked for is a row they don't have to fit — honour the setting.
  grid.style.setProperty('--cols', state.cfg.board.columns);
  grid.classList.toggle('editing', state.editing);
  grid.innerHTML = '';

  const page = curPage();
  if (!page) return;
  $('boardname').textContent = page.name;
  $('delboard').disabled = state.cfg.board.pages.length === 1;
  updateEditButtons();

  for (const b of page.buttons) grid.appendChild(makeTile(b));

  if (state.editing) {
    const add = el('button', 'tile add');
    add.innerHTML = '<span class="ico">＋</span><span class="lbl">Add</span>';
    add.addEventListener('click', openCatalog);
    grid.appendChild(add);
  }
  fitBoard();
  renderPages();
}

function makeTile(b) {
  const t = el('button', 'tile');
  t.dataset.id = b.id;
  t.style.setProperty('--c', b.color || '#4C8DFF');
  t.appendChild(el('span', 'ico', b.icon || '●'));
  t.appendChild(el('span', 'lbl', b.label || ''));
  const combo = comboText(b.action);
  if (combo) t.appendChild(el('span', 'combo', combo));

  // A button with no catalog entry behind it is one you built. Mark it, always
  // — not only in edit mode — because the useful moment is while you are using
  // the board and wondering whether a tile is yours or one of the presets.
  const mine = !b.builtin;
  if (mine) t.appendChild(el('span', 'mine', '★'));
  t.setAttribute('aria-label',
    `${b.label}${combo ? ', ' + combo : ''}${mine ? ', custom shortcut' : ''}`);

  if (state.editing) {
    if (b.builtin) t.classList.add('locked');
    const del = el('button', 'del', '✕');
    del.setAttribute('aria-label', `Delete ${b.label}`);
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      const list = curPage().buttons;
      const i = list.indexOf(b);
      if (i >= 0) list.splice(i, 1);
      saveBoard(); renderBoard();
      toast(`Removed ${b.label}`);
    });
    t.appendChild(del);
    t.addEventListener('click', () => {
      if (dragMoved) return;
      // Built-ins come from the catalog and can be removed or rearranged, but
      // not rewritten — editing one would silently fork it from the catalog
      // entry it claims to be.
      if (b.builtin) {
        toast(`"${b.label}" is a built-in. Delete it and add a custom one to change it.`);
        return;
      }
      openEditor(b);
    });
    attachDrag(t, b);
    return t;
  }

  // Fire on touchstart: a deck button should feel instant.
  let fired = false;
  t.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (!state.connected) { toast('Connect to a device first'); return; }
    fired = true;
    t.classList.add('down');
    sendJSON({ t: 'press', id: b.id });
  }, { passive: false });
  const up = () => {
    t.classList.remove('down');
    t.classList.add('fired');
    setTimeout(() => t.classList.remove('fired'), 400);
  };
  t.addEventListener('touchend', up);
  t.addEventListener('touchcancel', () => t.classList.remove('down'));
  t.addEventListener('click', () => {
    if (fired) { fired = false; return; }
    if (!state.connected) { toast('Connect to a device first'); return; }
    sendJSON({ t: 'press', id: b.id });
    up();
  });
  return t;
}

// ─── Drag to rearrange ────────────────────────────────────────────────────
// Pointer events rather than touch events, so the same code works with a
// finger on the iPad and a mouse while testing on the Mac.

let drag = null;
let dragMoved = false;

function attachDrag(tile, b) {
  tile.addEventListener('pointerdown', (e) => {
    // The delete badge sits on top of the tile; dragging from it would be
    // an easy way to lose a button by accident.
    if (e.target.closest('.del')) return;

    const r = tile.getBoundingClientRect();
    drag = {
      b, tile,
      grabX: e.clientX - r.left,
      grabY: e.clientY - r.top,
      w: r.width, h: r.height,
      startX: e.clientX, startY: e.clientY,
    };
    dragMoved = false;
    tile.setPointerCapture(e.pointerId);
  });

  tile.addEventListener('pointermove', (e) => {
    if (!drag || drag.tile !== tile) return;

    // A few pixels of slop so a tap to edit is not read as a drag.
    if (!dragMoved) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
      dragMoved = true;
      $('grid').classList.add('dragging');
      tile.classList.add('drag-ghost');
      tile.style.width = `${drag.w}px`;
      tile.style.height = `${drag.h}px`;
        }

    tile.style.left = `${e.clientX - drag.grabX}px`;
    tile.style.top = `${e.clientY - drag.grabY}px`;

    // What is under the finger? Hide the floating tile first so it is not
    // found instead of the tile beneath it.
    tile.style.visibility = 'hidden';
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tile');
    tile.style.visibility = '';
    if (!under || under === tile || under.classList.contains('add')) return;

    const list = curPage().buttons;
    const from = list.indexOf(drag.b);
    const to = [...$('grid').children].filter((c) => !c.classList.contains('add')).indexOf(under);
    if (from < 0 || to < 0 || from === to) return;

    list.splice(to, 0, list.splice(from, 1)[0]);
    saveBoard();
    reflow(tile);
  });

  const finish = (e) => {
    if (!drag || drag.tile !== tile) return;
    if (dragMoved) {
      tile.classList.remove('drag-ghost');
      tile.style.cssText = '';
      clearFlip();
      $('grid').classList.remove('dragging');
      renderBoard();
    }
    drag = null;
    // Let the click handler see the flag, then clear it.
    setTimeout(() => { dragMoved = false; }, 0);
  };
  tile.addEventListener('pointerup', finish);
  tile.addEventListener('pointercancel', finish);
}

/**
 * Re-place the siblings around the floating tile and slide them into their new
 * spots, so the gap opens up ahead of your finger and you can see where the
 * button will land before letting go.
 *
 * FLIP: measure where each tile is, reorder the DOM, measure again, then jump
 * each tile back to its old position with a transform and let it animate to
 * zero. Cheaper and far smoother than animating layout itself.
 */
function reflow(floating) {
  const grid = $('grid');
  const movers = [...grid.children].filter((c) => c !== floating && c.dataset.id);
  const before = new Map(movers.map((t) => [t, t.getBoundingClientRect()]));

  const buttons = curPage().buttons;
  const byId = new Map([...grid.children]
    .filter((c) => c.dataset.id)
    .map((c) => [c.dataset.id, c]));
  for (const b of buttons) {
    const node = byId.get(b.id);
    if (node && node !== floating) grid.appendChild(node);
  }
  const add = grid.querySelector('.tile.add');
  if (add) grid.appendChild(add);

  for (const t of movers) {
    const a = before.get(t);
    const b = t.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (!dx && !dy) continue;

    t.style.transition = 'none';
    t.style.transform = `translate(${dx}px, ${dy}px)`;
    // Two frames: one to commit the inverted position, one to release it.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      t.style.transition = 'transform 220ms cubic-bezier(.2,.7,.3,1)';
      t.style.transform = '';
    }));
  }
}

/** Clear anything FLIP left behind before the grid is rebuilt. */
function clearFlip() {
  for (const t of $('grid').children) {
    t.style.transition = '';
    t.style.transform = '';
  }
}

/** Board switcher: a menu under the board name, rather than a row of tabs
 *  eating a strip of the screen for something used a few times a day. */
function renderPages() {
  const menu = $('boardmenu');
  menu.innerHTML = '';

  state.cfg.board.pages.forEach((p, i) => {
    const b = el('button', 'menuitem' + (i === state.page ? ' on' : ''), p.name);
    b.setAttribute('role', 'menuitem');
    b.addEventListener('click', () => {
      state.page = i; closeBoardMenu(); renderBoard();
    });
    menu.appendChild(b);
  });

  const rename = el('button', 'menuitem sub', '✎  Rename this board');
  rename.addEventListener('click', () => { closeBoardMenu(); renamePage(state.page); });
  menu.appendChild(rename);

  const add = el('button', 'menuitem sub', '＋  New board');
  add.addEventListener('click', () => {
    state.cfg.board.pages.push({ name: `Board ${state.cfg.board.pages.length + 1}`, buttons: [] });
    state.page = state.cfg.board.pages.length - 1;
    closeBoardMenu(); saveBoard(); renderBoard();
  });
  menu.appendChild(add);
}

function openBoardMenu() {
  renderPages();
  $('boardmenu').hidden = false;
  $('boardswitch').setAttribute('aria-expanded', 'true');
}
function closeBoardMenu() {
  $('boardmenu').hidden = true;
  $('boardswitch').setAttribute('aria-expanded', 'false');
}

$('delboard').addEventListener('click', () => {
  const pages = state.cfg.board.pages;
  if (pages.length === 1) {
    toast('This is your only board — rename it or add another first');
    return;
  }
  const page = curPage();
  const n = page.buttons.length;
  // Deleting a board takes its buttons with it, so say how many before asking.
  if (!confirm(`Delete "${page.name}"${n ? ` and its ${n} button${n === 1 ? '' : 's'}` : ''}?`)) return;
  pages.splice(state.page, 1);
  state.page = Math.max(0, state.page - 1);
  saveBoard();
  renderBoard();
  toast('Board deleted');
});

$('boardswitch').addEventListener('click', (e) => {
  e.stopPropagation();
  if ($('boardmenu').hidden) openBoardMenu(); else closeBoardMenu();
});
document.addEventListener('click', (e) => {
  if (!$('boardmenu').hidden && !$('boardmenu').contains(e.target)) closeBoardMenu();
});

function renamePage(i) {
  const name = prompt('Page name (empty to delete)', state.cfg.board.pages[i].name);
  if (name === null) return;
  if (!name.trim()) {
    if (state.cfg.board.pages.length === 1) return toast('Keep at least one page');
    if (!confirm('Delete this page and its buttons?')) return;
    state.cfg.board.pages.splice(i, 1);
    state.page = Math.max(0, i - 1);
  } else {
    state.cfg.board.pages[i].name = name.trim();
  }
  saveBoard(); renderBoard();
}

function updateEditButtons() {
  const edit = $('editmode');
  const discard = $('discard');

  if (!state.editing) {
    edit.textContent = 'Edit';
    edit.classList.remove('primary');
    edit.setAttribute('aria-pressed', 'false');
    discard.classList.remove('show');
    updateCatalogButtons();
    return;
  }
  // Editing with nothing changed is a no-op, so offer "Done" rather than a
  // Save button that would save nothing.
  edit.textContent = state.dirty ? 'Save changes' : 'Done';
  edit.classList.toggle('primary', state.dirty);
  edit.setAttribute('aria-pressed', 'true');
  discard.classList.toggle('show', state.dirty);
  updateCatalogButtons();
}

function enterEdit() {
  state.editing = true;
  state.dirty = false;
  // Deep copy so Discard can restore exactly what was there.
  state.snapshot = structuredClone(state.cfg.board);
  updateEditButtons();
  renderBoard();
}

function leaveEdit() {
  state.editing = false;
  state.dirty = false;
  state.snapshot = null;
  updateEditButtons();
  renderBoard();
}

$('editmode').addEventListener('click', () => {
  if (!state.editing) return enterEdit();
  if (state.dirty) savedToast(flushBoard());
  leaveEdit();
});

$('discard').addEventListener('click', () => {
  if (!state.dirty) return leaveEdit();
  if (!confirm('Discard your changes to this board?')) return;
  state.cfg.board = state.snapshot;
  state.page = Math.min(state.page, state.cfg.board.pages.length - 1);
  leaveEdit();
  toast('Changes discarded');
});

// ─── Sheets ───────────────────────────────────────────────────────────────

let lastFocus = null;
function openSheet(id) {
  lastFocus = document.activeElement;
  $(id).hidden = false;
  $(id).querySelector('input,select,button')?.focus();
}
function closeSheet(id) {
  $(id).hidden = true;
  lastFocus?.focus();
}
for (const b of document.querySelectorAll('[data-close]')) {
  b.addEventListener('click', () => closeSheet(b.dataset.close));
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const s of document.querySelectorAll('.sheet:not([hidden])')) s.hidden = true;
});

// ─── Catalog: quick-add built-ins ─────────────────────────────────────────
// Everything here is filtered against the connected device's advertised
// capabilities, so an action the target cannot perform is never offered.

const supports = (needs) => !state.caps || state.caps.actions.includes(needs);

function openCatalog() {
  $('catsearch').value = '';
  renderCatalog();
  openSheet('catalog');
}

/** The catalog gets the same three-state footer as the board editor, because
 *  picking and unpicking entries is editing the board — you should be able to
 *  change your mind about a whole session of it, not just the last tap. */
function updateCatalogButtons() {
  const done = $('cat-done');
  const discard = $('cat-discard');
  const changed = state.editing && state.dirty;

  done.textContent = changed ? 'Save changes' : 'Done';
  done.classList.toggle('primary', changed);
  discard.classList.toggle('show', changed);
}

$('cat-done').addEventListener('click', () => {
  if (state.editing && state.dirty) {
    const ok = flushBoard();
    leaveEdit();
    savedToast(ok);
  }
  closeSheet('catalog');
});

$('cat-discard').addEventListener('click', () => {
  if (!state.dirty) return closeSheet('catalog');
  if (!confirm('Discard your changes to this board?')) return;
  state.cfg.board = state.snapshot;
  state.page = Math.min(state.page, state.cfg.board.pages.length - 1);
  leaveEdit();
  closeSheet('catalog');
  toast('Changes discarded');
});

function renderCatalog() {
  const q = $('catsearch').value.trim().toLowerCase();
  const wrap = $('catlist');
  wrap.innerHTML = '';

  const source = catalogNow();
  const usable = source.filter((c) => supports(c.needs));
  const hidden = source.length - usable.length;
  $('catnote').textContent = hidden
    ? `${usable.length} available on ${state.device?.name || 'this device'} · ${hidden} hidden (not supported)`
    : `${usable.length} shortcuts available`;

  // One set for both kinds. Custom entries used to be matched on the *board
  // button's* id, which is freshly generated on add and so never matched —
  // which is why your own shortcuts never showed a tick and always duplicated.
  const onBoard = new Set((curPage()?.buttons || []).map(originOf).filter(Boolean));

  // ── Your own shortcuts first, and only if you have any ──
  const mine = (state.customs || []).filter((c) =>
    !q || `${c.label} ${c.action?.combo || comboText(c.action)}`.toLowerCase().includes(q));

  if (mine.length) {
    const g = el('div', 'catgroup');
    g.appendChild(el('h3', null, 'Custom shortcuts'));
    const box = el('div', 'catitems');
    for (const c of mine) {
      const b = el('button', 'catitem');
      const on = onBoard.has(c.id);
      if (on) b.dataset.on = '1';
      b.appendChild(el('span', 'ico', c.icon || '⭐'));
      const t = el('div', 't');
      t.appendChild(el('div', 'nm', c.label || 'Custom'));
      t.appendChild(el('div', 'combo', comboText(c.action)));
      b.appendChild(t);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label',
        `${on ? 'Remove' : 'Add'} ${c.label}, ${comboText(c.action)}`);
      b.addEventListener('click', () => addCustomToBoard(c));

      // Removing it from the library, not just this board.
      const del = el('button', 'catdel', '✕');
      del.setAttribute('aria-label', `Forget ${c.label}`);
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm(`Forget the custom shortcut "${c.label}"? Buttons already on a board stay.`)) return;
        state.customs = state.customs.filter((x) => x.id !== c.id);
        sendState({ t: 'setprefs', prefs: { customs: state.customs } });
        renderCatalog();
      });
      b.appendChild(del);
      box.appendChild(b);
    }
    g.appendChild(box);
    wrap.appendChild(g);
  }

  const groups = {};
  for (const c of usable) {
    if (q && !(`${c.label} ${c.cat} ${comboText(c.action)}`.toLowerCase().includes(q))) continue;
    (groups[c.cat] ||= []).push(c);
  }

  for (const [cat, items] of Object.entries(groups)) {
    const g = el('div', 'catgroup');
    g.appendChild(el('h3', null, cat));
    const box = el('div', 'catitems');
    for (const c of items) {
      const b = el('button', 'catitem');
      const on = onBoard.has(c.id);
      if (on) b.dataset.on = '1';
      b.appendChild(el('span', 'ico', c.icon));
      const t = el('div', 't');
      t.appendChild(el('div', 'nm', c.label + (c.risky ? ' ⚠' : '')));
      t.appendChild(el('div', 'combo', comboText(c.action)));
      b.appendChild(t);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label',
        `${on ? 'Remove' : 'Add'} ${c.label}, ${comboText(c.action)}`);
      b.addEventListener('click', () => addFromCatalog(c));
      box.appendChild(b);
    }
    g.appendChild(box);
    wrap.appendChild(g);
  }
  if (!wrap.children.length) wrap.appendChild(el('p', 'empty', 'No matches.'));
  updateCatalogButtons();
}
$('catsearch').addEventListener('input', renderCatalog);

/** Build a button from scratch instead of picking a preset: blank it out and
 *  hand straight over to the editor, where the key picker and icon live. */
/** Keep the library in step with a custom button, so it can be re-added to
 *  any board later rather than living only where it was created. */
function rememberCustom(b) {
  if (b.builtin) return;
  const entry = {
    id: b.id, label: b.label, icon: b.icon, color: b.color,
    action: structuredClone(b.action),
  };
  const i = state.customs.findIndex((c) => c.id === b.id);
  if (i >= 0) state.customs[i] = entry; else state.customs.push(entry);
  sendState({ t: 'setprefs', prefs: { customs: state.customs } });
}

$('cat-custom').addEventListener('click', () => {
  const id = uid();
  const b = {
    id,
    // Same id in both places, so the library entry and the board button stay
    // linked and the catalog can show — and un-toggle — this one too.
    from: id,
    label: 'New',
    icon: '⭐',
    color: '#4C8DFF',
    action: isWin()
      ? { type: 'key', key: '', mods: ['ctrl'] }
      : { type: 'key', key: '', mods: ['cmd'] },
  };
  curPage().buttons.push(b);
  rememberCustom(b);
  saveBoard();
  renderBoard();
  closeSheet('catalog');
  openEditor(b);
});

/** Drop a saved custom shortcut onto the current board. */
/** Where a board button came from: a catalog entry (`builtin`) or one of your
 *  own saved shortcuts (`from`). Either way it is the link that lets the
 *  catalog show what is already on the board — and lets a second tap take it
 *  off again instead of adding a duplicate. */
const originOf = (b) => b.builtin || b.from || null;

/**
 * The catalog is a set of toggles, not an "add" queue.
 *
 * It used to push a fresh copy on every tap, so tapping the same entry five
 * times left five identical buttons and the ✓ told you nothing about how many.
 * Now a tap adds it if it is missing and removes it if it is there, which is
 * what the tick and the highlight were already implying.
 */
function toggleOnBoard(c, { builtin }) {
  const list = curPage().buttons;
  const at = list.findIndex((b) => originOf(b) === c.id);

  if (at >= 0) {
    list.splice(at, 1);
    toast(`Removed ${c.label}`);
  } else {
    list.push({
      id: uid(), label: c.label, icon: c.icon, color: c.color,
      action: structuredClone(c.action),
      ...(builtin ? { builtin: c.id } : { from: c.id }),
    });
    toast(`Added ${c.label}`);
  }
  saveBoard(); renderBoard(); renderCatalog();
}

const addCustomToBoard = (c) => toggleOnBoard(c, { builtin: false });
const addFromCatalog = (c) => toggleOnBoard(c, { builtin: true });

// ─── Button editor ────────────────────────────────────────────────────────

const COLORS = ['#4C8DFF', '#6366F1', '#8B5CF6', '#EC4899', '#FF5C5C',
                '#F5A524', '#22C55E', '#14B8A6', '#0EA5E9', '#7C8494'];
const TYPE_LABEL = {
  key: 'Keyboard shortcut', media: 'Media / volume key', open: 'Open app, URL or file',
  shell: 'Shell command (no window)', terminal: 'Run in Terminal (opens a window)',
  applescript: 'AppleScript', text: 'Type text', mouse: 'Mouse click',
};

let editing = null;

function openEditor(b) {
  editing = b;
  $('ed-h').textContent = b.builtin ? 'Button' : 'Custom shortcut';
  $('e-label').value = b.label || '';
  $('e-icon').value = b.icon || '';

  const sel = $('e-type');
  sel.innerHTML = '';
  for (const [v, label] of Object.entries(TYPE_LABEL)) {
    if (!supports(v)) continue;            // never offer an unsupported action
    const o = el('option', null, label);
    o.value = v;
    sel.appendChild(o);
  }
  sel.value = b.action?.type || 'key';
  renderSwatches();
  renderFields();
  openSheet('editor');
}

function renderSwatches() {
  const w = $('swatches');
  w.innerHTML = '';
  for (const c of COLORS) {
    const s = el('button', 'swatch');
    s.style.background = c;
    s.setAttribute('role', 'radio');
    s.setAttribute('aria-checked', editing.color === c ? 'true' : 'false');
    s.setAttribute('aria-label', `Colour ${c}`);
    s.addEventListener('click', () => { editing.color = c; renderSwatches(); commit(); });
    w.appendChild(s);
  }
}

const MEDIA_KEYS = [
  ['playpause', 'Play / Pause'], ['next', 'Next track'], ['prev', 'Previous track'],
  ['soundup', 'Volume up'], ['sounddown', 'Volume down'], ['mute', 'Mute'],
  ['brightnessup', 'Brightness up'], ['brightnessdown', 'Brightness down'],
];

function renderFields() {
  const a = editing.action || {};
  const type = $('e-type').value;
  const f = $('fields');
  f.innerHTML = '';

  const textField = (label, key, val, multi, ph) => {
    const d = el('div', 'field');
    d.appendChild(el('label', null, label));
    const i = multi ? el('textarea') : el('input');
    if (!multi) i.type = 'text';
    i.id = `f-${key}`; i.value = val ?? ''; if (ph) i.placeholder = ph;
    d.appendChild(i);
    f.appendChild(d);
  };

  if (type === 'key') {
    const d = el('div', 'field');
    d.appendChild(el('label', null, 'Shortcut'));

    // The box is the control, not a readout of one. Tapping the thing that
    // shows the shortcut to change the shortcut is the obvious move, and it
    // was previously inert — you had to find the button underneath it.
    const combo = comboText({ type: 'key', key: a.key, mods: a.mods });
    const show = el('button', 'kp-preview tappable');
    show.appendChild(el('span', combo ? 'kp-chip' : 'kp-empty', combo || 'No shortcut yet'));
    show.appendChild(el('span', 'kp-hint', 'tap to choose on the keyboard'));
    show.setAttribute('aria-label',
      combo ? `Shortcut ${combo}. Tap to change.` : 'No shortcut set. Tap to choose one.');
    show.addEventListener('click', () => openKeyPicker(editing.action || {}));
    d.appendChild(show);

    const row = el('div', 'ed-actions');
    const pick = el('button', 'btn primary', 'Choose on keyboard');
    pick.addEventListener('click', () => openKeyPicker(editing.action || {}));
    const gest = el('button', 'btn', 'From gesture');
    gest.addEventListener('click', openGesturePicker);
    row.appendChild(pick); row.appendChild(gest);
    d.appendChild(row);
    f.appendChild(d);
  } else if (type === 'media') {
    const d = el('div', 'field');
    d.appendChild(el('label', null, 'Key'));
    const s = el('select'); s.id = 'f-k';
    for (const [v, l] of MEDIA_KEYS) {
      if (state.caps && !state.caps.mediaKeys.includes(v)) continue;
      const o = el('option', null, l); o.value = v;
      if (a.k === v) o.selected = true;
      s.appendChild(o);
    }
    d.appendChild(s); f.appendChild(d);
  } else if (type === 'open') {
    textField('App name, URL or path', 'target', a.target, false, 'Spotify · https://… · ~/Documents');
  } else if (type === 'shell') {
    textField('Command', 'cmd', a.cmd, true, 'say hello');
    f.appendChild(el('p', 'note',
      'Runs invisibly with nowhere to show output — right for one-shot commands '
      + 'like pmset. To watch a build or stop it with Ctrl-C, use Run in Terminal.'));
  } else if (type === 'terminal') {
    textField('Folder', 'dir', a.dir, false, '~/Projects/my-app');
    textField('Command', 'cmd', a.cmd, true, 'npm run dev');
    f.appendChild(el('p', 'note',
      'Opens a real Terminal window, changes to the folder and runs the command '
      + 'there — so you see the output and can Ctrl-C it. Leave the folder blank '
      + 'to start in your home directory.'));
  } else if (type === 'applescript') {
    textField('Script', 'script', a.script, true, 'tell app "Music" to next track');
  } else if (type === 'text') {
    textField('Text to type', 's', a.s, true);
  } else if (type === 'mouse') {
    const d = el('div', 'field');
    d.appendChild(el('label', null, 'Button'));
    const s = el('select'); s.id = 'f-b';
    for (const v of ['left', 'right', 'middle']) {
      const o = el('option', null, v); o.value = v;
      if (a.b === v) o.selected = true;
      s.appendChild(o);
    }
    d.appendChild(s); f.appendChild(d);
    textField('Clicks', 'n', a.n || 1, false);
  }

  for (const i of f.querySelectorAll('input,textarea,select')) {
    i.addEventListener('input', commit);
    i.addEventListener('change', commit);
  }
}

function commit() {
  if (!editing) return;
  const type = $('e-type').value;
  const v = (k) => $(`f-${k}`)?.value ?? '';

  editing.label = $('e-label').value;
  editing.icon = $('e-icon').value;

  const prev = editing.action || {};
  const a = { type };
  if (type === 'key') { a.key = prev.key; a.mods = prev.mods || []; }
  else if (type === 'media') a.k = v('k');
  else if (type === 'open') a.target = v('target');
  else if (type === 'shell') a.cmd = v('cmd');
  else if (type === 'terminal') {
    a.cmd = v('cmd'); a.dir = v('dir');
    // Titles the Terminal window and names the script file, so two project
    // buttons do not overwrite each other's script.
    a.title = editing.label || '';
  }
  else if (type === 'applescript') a.script = v('script');
  else if (type === 'text') a.s = v('s');
  else if (type === 'mouse') { a.b = v('b'); a.n = Number(v('n')) || 1; }

  editing.action = a;
  rememberCustom(editing);
  saveBoard(); renderBoard();
}

$('e-type').addEventListener('change', () => { editing.action = { type: $('e-type').value }; renderFields(); commit(); });
$('e-test').addEventListener('click', () => {
  if (!state.connected) return toast('Connect to a device first');
  sendJSON({ t: 'action', action: editing.action });
  toast('Sent');
});
$('e-delete').addEventListener('click', () => {
  if (!confirm(`Delete "${editing.label}"?`)) return;
  const list = curPage().buttons;
  const i = list.indexOf(editing);
  if (i >= 0) list.splice(i, 1);
  saveBoard(); renderBoard();
  closeSheet('editor');
  toast('Deleted — re-add it any time from Add shortcut');
});

// ─── Live on-screen keyboard ──────────────────────────────────────────────
// Deliberately not the iPad's own keyboard: that one types into Safari and has
// no ⌘, no ⌃, no function row, and no Windows key — none of which you can send
// to another computer. This draws the target machine's keyboard instead.

/** Codes that act as modifiers rather than characters. Shared by the live
 *  keyboard and the shortcut capture sheet. */
const MOD_KEYS = new Set(['cmd', 'shift', 'alt', 'ctrl', 'fn', 'win']);

/** Physical keyboard rows, minus the bottom row — that one differs per
 *  platform and is appended by liveRows(). [face, code, widthClass] */
const KB_ROWS = [
  [['esc','escape','w15'],['F1','f1'],['F2','f2'],['F3','f3'],['F4','f4'],['F5','f5'],
   ['F6','f6'],['F7','f7'],['F8','f8'],['F9','f9'],['F10','f10'],['F11','f11'],['F12','f12']],
  [['`','`'],['1','1'],['2','2'],['3','3'],['4','4'],['5','5'],['6','6'],['7','7'],
   ['8','8'],['9','9'],['0','0'],['−','-'],['=','='],['⌫','delete','w20']],
  [['⇥','tab','w15'],['Q','q'],['W','w'],['E','e'],['R','r'],['T','t'],['Y','y'],['U','u'],
   ['I','i'],['O','o'],['P','p'],['[','['],[']',']'],['\\','\\','w15']],
  [['caps','capslock','w20'],['A','a'],['S','s'],['D','d'],['F','f'],['G','g'],['H','h'],
   ['J','j'],['K','k'],['L','l'],[';',';'],["'","'"],['⏎','return','w20']],
  [['⇧','shift','w25'],['Z','z'],['X','x'],['C','c'],['V','v'],['B','b'],['N','n'],
   ['M','m'],[',',','],['.','.'],['/','/'],['⇧','shift','w25']],
];

const KB_BOTTOM_MAC = [['fn','fn'],['⌃','ctrl'],['⌥','alt'],['⌘','cmd','w15'],
  ['space','space','w60'],['⌘','cmd','w15'],['⌥','alt'],
  ['←','left'],['↑','up'],['↓','down'],['→','right']];
const KB_BOTTOM_WIN = [['Ctrl','ctrl','w15'],['⊞','win'],['Alt','alt'],
  ['space','space','w60'],['Alt','alt'],['⊞','win'],['Ctrl','ctrl','w15'],
  ['←','left'],['↑','up'],['↓','down'],['→','right']];

function liveRows() {
  const rows = KB_ROWS.slice(0, 5).map((r) => r.slice());
  // Windows spells these out; macOS uses glyphs.
  if (isWin()) {
    rows[1] = rows[1].map((k) => (k[1] === 'delete' ? ['Backspace', 'delete', 'w20'] : k));
    rows[3] = rows[3].map((k) => (k[1] === 'return' ? ['Enter', 'return', 'w20'] : k));
    rows[2] = rows[2].map((k) => (k[1] === 'tab' ? ['Tab', 'tab', 'w15'] : k));
    rows[4] = rows[4].map((k) => (k[1] === 'shift' ? ['Shift', 'shift', 'w25'] : k));
  }
  rows.push(isWin() ? KB_BOTTOM_WIN : KB_BOTTOM_MAC);
  return rows;
}

const liveMods = new Set();

function openLiveKeyboard() {
  liveMods.clear();
  renderLiveKeyboard();
  openSheet('livekb');
}

function renderLiveKeyboard() {
  $('lk-note').textContent = (isWin() ? 'Windows layout' : 'macOS layout')
    + ' · hold keys to type shortcuts';
  $('lk-combo').textContent = [...liveMods].map((m) => MODSYM[m] || m).join('') || '—';

  const wrap = $('lk-keys');
  wrap.innerHTML = '';
  for (const row of liveRows()) {
    const r = el('div', 'krow');
    for (const [label, code, w] of row) {
      const k = el('button', 'key' + (w ? ' ' + w : ''), label);
      k.setAttribute('aria-label', code);
      const mod = MOD_KEYS.has(code) || code === 'win';
      if (mod && liveMods.has(code)) k.setAttribute('aria-pressed', 'true');

      k.addEventListener('click', () => {
        if (mod) {
          if (liveMods.has(code)) liveMods.delete(code); else liveMods.add(code);
          renderLiveKeyboard();
          return;
        }
        // A plain key fires immediately, carrying whatever is held.
        sendJSON({ t: 'key', key: code, mods: [...liveMods] });
        liveMods.clear();
        renderLiveKeyboard();
      });
      r.appendChild(k);
    }
    wrap.appendChild(r);
  }
}

// ─── Shortcut capture ─────────────────────────────────────────────────────
//
// Press and hold a key to add it to the combo; hold it again to take it back
// out. Each selected key wears the position it occupies, so a three-key
// shortcut reads in the order it will actually be sent rather than as an
// unordered set.
//
// Hold rather than tap on purpose: a keyboard this dense is easy to brush
// while scrolling, and a stray tap silently rewriting a shortcut is worse
// than a deliberate half-second press.

const HOLD_MS = 320;

const capture = {
  seq: [],        // ordered key codes, e.g. ['cmd','shift','4']
  saved: [],      // what it was when the sheet opened
  target: null,   // the button being edited
};

const isModCode = (code) => MOD_KEYS.has(code) || code === 'win';
const seqEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Ordered sequence → the {key, mods} the host understands. */
function seqToAction(seq) {
  const mods = seq.filter(isModCode);
  const key = seq.find((c) => !isModCode(c)) || '';
  return { type: 'key', key, mods, seq: [...seq] };
}

/** Rebuild the ordered sequence from a saved action, so reopening a shortcut
 *  shows the same keys lit in the same order. */
function actionToSeq(a) {
  if (Array.isArray(a?.seq) && a.seq.length) return [...a.seq];
  const out = [...(a?.mods || [])];
  if (a?.key) out.push(a.key);
  return out;
}

function openKeyPicker(a) {
  capture.target = editing;
  capture.seq = actionToSeq(a);
  capture.saved = [...capture.seq];
  renderKeyPicker();
  openSheet('keypick');
}

function captureDirty() { return !seqEqual(capture.seq, capture.saved); }

function renderKeyPicker() {
  const dirty = captureDirty();
  $('kp-note').textContent =
    (isWin() ? 'Windows layout' : 'macOS layout') +
    ' · press and hold a key to add it, hold again to remove it';

  $('kp-done').hidden = dirty;
  $('kp-save').hidden = !dirty;
  $('kp-discard').hidden = !dirty;

  const preview = $('kp-preview');
  preview.innerHTML = '';
  if (!capture.seq.length) {
    preview.appendChild(el('span', 'kp-empty', 'No keys yet — hold a key below'));
  } else {
    capture.seq.forEach((code, i) => {
      if (i) preview.appendChild(el('span', 'kp-plus', '+'));
      preview.appendChild(el('span', 'kp-chip', keyFace(code)));
    });
  }

  const kb = $('keyboard');
  kb.innerHTML = '';
  for (const row of liveRows()) {
    const r = el('div', 'krow');
    for (const [label, code, w] of row) {
      const k = el('button', 'key' + (w ? ' ' + w : ''), label);
      k.setAttribute('aria-label', code);

      const at = capture.seq.indexOf(code);
      if (at >= 0) {
        k.classList.add('picked');
        k.setAttribute('aria-pressed', 'true');
        const badge = el('span', 'kbadge', String(at + 1));
        k.appendChild(badge);
      }
      attachHold(k, code);
      r.appendChild(k);
    }
    kb.appendChild(r);
  }
}

/** Human-readable face for a key code, in the current platform's notation. */
function keyFace(code) {
  if (isModCode(code)) return (MODSYM[code] || code).replace(/\+$/, '');
  return ({
    space: 'Space', return: '⏎', delete: '⌫', tab: '⇥', escape: 'esc',
    left: '←', right: '→', up: '↑', down: '↓',
  })[code] || code.toUpperCase();
}

/** Press-and-hold toggling, with the key filling up while you hold it. */
function attachHold(k, code) {
  let timer = null;
  let held = false;

  const start = (e) => {
    e.preventDefault();
    held = false;
    k.classList.add('holding');
    timer = setTimeout(() => {
      held = true;
      k.classList.remove('holding');
      const at = capture.seq.indexOf(code);
      if (at >= 0) capture.seq.splice(at, 1); else capture.seq.push(code);
      renderKeyPicker();
    }, HOLD_MS);
  };

  const cancel = () => {
    clearTimeout(timer);
    k.classList.remove('holding');
  };

  k.addEventListener('pointerdown', start);
  k.addEventListener('pointerup', cancel);
  k.addEventListener('pointerleave', cancel);
  k.addEventListener('pointercancel', cancel);
  // A quick tap is not enough; say so rather than doing nothing.
  k.addEventListener('click', (e) => {
    e.preventDefault();
    if (!held) toast('Hold the key for a moment to add it');
  });
}

$('kp-save').addEventListener('click', () => {
  if (!capture.target) return closeSheet('keypick');
  capture.target.action = seqToAction(capture.seq);
  capture.saved = [...capture.seq];
  rememberCustom(capture.target);
  saveBoard();
  renderBoard();
  renderFields();
  closeSheet('keypick');
  toast('Shortcut saved');
});

$('kp-discard').addEventListener('click', () => {
  capture.seq = [...capture.saved];
  renderKeyPicker();
  toast('Changes discarded');
});

$('kp-done').addEventListener('click', () => closeSheet('keypick'));

// ─── Gesture picker ─// ─── Gesture picker ───────────────────────────────────────────────────────
// Honest about delivery: a gesture that macOS will not let us synthesise is
// shown as unavailable rather than silently doing nothing.

let gpOS = 'macos';

function openGesturePicker() { renderGestures(); openSheet('gesturepick'); }

function renderGestures() {
  const tabs = $('gp-tabs');
  tabs.innerHTML = '';
  for (const [id, label] of [['macos', 'MacBook trackpad'], ['windows', 'Windows touchpad']]) {
    const b = el('button', 'btn' + (gpOS === id ? ' primary' : ''), label);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', gpOS === id ? 'true' : 'false');
    b.addEventListener('click', () => { gpOS = id; renderGestures(); });
    tabs.appendChild(b);
  }

  $('gp-note').textContent = gpOS === (state.caps?.os || 'macos')
    ? 'Green gestures are sent as real input. Amber ones are delivered as the equivalent keyboard shortcut, which produces the same result.'
    : `Showing the ${gpOS === 'macos' ? 'macOS' : 'Windows'} set — the connected device runs ${state.caps?.os || 'macOS'}, so these are for reference.`;

  const list = $('gp-list');
  list.innerHTML = '';
  const gestures = gpOS === 'macos'
    ? (state.caps?.gestures || [])
    : (window.WINDOWS_GESTURES || []);

  for (const g of gestures) {
    const b = el('button', 'gest');
    const t = el('div', 't');
    t.appendChild(el('div', 'nm', g.label));
    t.appendChild(el('div', 'does', g.does || g.why || ''));
    b.appendChild(t);
    const tag = el('span', 'tag ' + g.mode,
      g.mode === 'native' ? 'real input' : g.mode === 'mapped' ? 'via keys' : 'unavailable');
    b.appendChild(tag);

    const asButton = gestureToAction(g);
    if (!asButton) {
      b.disabled = true;
      b.setAttribute('aria-label', `${g.label}, unavailable: ${g.why || 'cannot be used as a button'}`);
    } else {
      b.addEventListener('click', () => {
        editing.action = asButton;
        if (!editing.label || editing.label === 'New') editing.label = g.does || g.label;
        saveBoard(); renderBoard(); renderFields();
        closeSheet('gesturepick');
        toast(`Set to ${g.label}`);
      });
    }
    list.appendChild(b);
  }
}

/** A gesture only becomes a *button* if it reduces to something sendable. */
function gestureToAction(g) {
  if (g.mode === 'mapped') return { type: 'key', key: g.key, mods: g.mods || [] };
  if (g.mode === 'native') {
    if (g.id === 'tap1') return { type: 'mouse', b: 'left', n: 1 };
    if (g.id === 'tap2') return { type: 'mouse', b: 'right', n: 1 };
    if (g.id === 'tap3') return { type: 'mouse', b: 'middle', n: 1 };
    if (g.id === 'doubletap') return { type: 'mouse', b: 'left', n: 2 };
    return null;      // drag / scroll are pad behaviours, not button actions
  }
  return null;
}

// ─── Settings ─────────────────────────────────────────────────────────────

const COL_NOTE = { 3: 'Roomy — 9 per page', 4: 'Comfortable — 20 per page',
                   5: 'Standard — 30 per page', 6: 'Dense — 42 per page' };

function syncSettings() {
  if (!state.cfg) return;
  const p = state.cfg.pointer;
  $('sens').value = p.sensitivity;      $('out-sens').textContent = p.sensitivity.toFixed(1);
  $('accel').value = p.acceleration;    $('out-accel').textContent = p.acceleration.toFixed(1);
  $('scrollspeed').value = p.scrollSpeed; $('out-scroll').textContent = p.scrollSpeed.toFixed(1);
  $('cols').value = state.cfg.board.columns;
  $('out-cols').textContent = state.cfg.board.columns;
  $('colnote').textContent = COL_NOTE[state.cfg.board.columns] || '';
  $('airspeed').value = p.airSpeed ?? 25;
  $('out-air').textContent = String(p.airSpeed ?? 25);
  $('airinvert').checked = !!p.airInvert;
  $('natural').checked = p.naturalScroll;
  $('taptoclick').checked = p.tapToClick;
  $('lefty').checked = state.lefty;
  syncZoom();

  const info = $('devinfo');
  info.innerHTML = '';
  const rows = state.connected
    ? [['Name', state.device.name], ['System', `${state.caps.os} ${state.caps.osVersion}`],
       ['Address', `${state.device.host}:${state.device.port}`],
       ['Can do', state.caps.actions.join(', ')],
       ['Gestures', `${state.caps.gestures.filter(g => g.mode === 'native').length} real, ` +
                    `${state.caps.gestures.filter(g => g.mode === 'mapped').length} via keys`]]
    : [['Status', 'Not connected']];
  for (const [k, v] of rows) {
    info.appendChild(el('dt', null, k));
    info.appendChild(el('dd', null, v));
  }
}

/** Send whatever the pointer settings currently are.
 *
 *  Reads `state.cfg.pointer` rather than scraping the Settings sheet's inputs.
 *  There are two places to change these now — the full sheet and the compact
 *  one on the pointer screen — and a function that reads one set of DOM nodes
 *  would silently send stale values when the other set was used. */
function pushPointer() {
  sendState({ t: 'setpointer', pointer: { ...state.cfg.pointer } });
}
for (const id of ['sens', 'accel', 'scrollspeed']) {
  $(id).addEventListener('input', () => {
    $(`out-${id === 'scrollspeed' ? 'scroll' : id}`).textContent = Number($(id).value).toFixed(1);
    Object.assign(state.cfg.pointer, {
      sensitivity: Number($('sens').value),
      acceleration: Number($('accel').value),
      scrollSpeed: Number($('scrollspeed').value),
    });
    pushPointer();
  });
}
for (const id of ['natural', 'taptoclick', 'airinvert']) $(id).addEventListener('change', () => {
  state.cfg.pointer.naturalScroll = $('natural').checked;
  state.cfg.pointer.tapToClick = $('taptoclick').checked;
  state.cfg.pointer.airInvert = $('airinvert').checked;
  pushPointer();
});
$('airspeed').addEventListener('input', () => {
  state.cfg.pointer.airSpeed = Number($('airspeed').value);
  $('out-air').textContent = $('airspeed').value;
  pushPointer();
});
/** Bind a pad button to both touch and mouse without double-firing. The pad
 *  cancels synthesised clicks, so touchend is the real event on a phone. */
function padButton(id, fn) {
  const b = $(id);
  if (!b) return;
  let handled = false;
  b.addEventListener('touchstart', (e) => { e.stopPropagation(); }, { passive: true });
  b.addEventListener('touchend', (e) => {
    e.preventDefault(); e.stopPropagation();
    handled = true; setTimeout(() => { handled = false; }, 400);
    fn();
  });
  b.addEventListener('click', (e) => { e.stopPropagation(); if (!handled) fn(); });
}

// ─── Pointer settings ─────────────────────────────────────────────────────
// The same values as the main Settings sheet, reachable without leaving
// pointer mode — where the main sheet is unreachable, because the pointer
// screen replaces the whole app. Both write to state.cfg.pointer and both go
// out through pushPointer, so they cannot drift apart.

function syncAirSettings() {
  const p = state.cfg?.pointer;
  if (!p || !$('p-air')) return;
  $('p-air').value = p.airSpeed ?? 25;
  $('p-out-air').textContent = String(p.airSpeed ?? 25);
  $('p-airinv').checked = !!p.airInvert;
  $('p-scroll').value = p.scrollSpeed ?? 1;
  $('p-out-scroll').textContent = Number(p.scrollSpeed ?? 1).toFixed(1);
  $('p-natural').checked = !!p.naturalScroll;
}

$('p-air').addEventListener('input', () => {
  state.cfg.pointer.airSpeed = Number($('p-air').value);
  $('p-out-air').textContent = $('p-air').value;
  pushPointer();
  syncSettings();          // keep the full sheet showing the same numbers
});
$('p-scroll').addEventListener('input', () => {
  state.cfg.pointer.scrollSpeed = Number($('p-scroll').value);
  $('p-out-scroll').textContent = Number($('p-scroll').value).toFixed(1);
  pushPointer();
  syncSettings();
});
for (const id of ['p-airinv', 'p-natural']) $(id).addEventListener('change', () => {
  state.cfg.pointer.airInvert = $('p-airinv').checked;
  state.cfg.pointer.naturalScroll = $('p-natural').checked;
  pushPointer();
  syncSettings();
});
$('p-recal').addEventListener('click', () => {
  closeSheet('airset');
  runCalibration();
});

padButton('air-gear', () => { syncAirSettings(); openSheet('airset'); });

padButton('airbtn', toggleAir);
// The pointer screen's own controls. Same touch binding: these sit over a
// surface that cancels synthesised clicks, and a click that does not register
// while you are looking at the Mac is worse than no button at all.
padButton('air-exit', toggleAir);
padButton('air-left', () => { sendClick('left'); flashPad('air-left'); });
padButton('air-right', () => { sendClick('right'); flashPad('air-right'); });

// ─── The scroll lane ──────────────────────────────────────────────────────
// Aiming the phone moves the pointer and nothing else, so while pointing there
// is no way to move a page. This is the wheel: drag along it and the page
// moves, obeying the same scroll speed and natural-scroll setting as the
// trackpad's two-finger scroll, so it feels like the same gesture.
(() => {
  const lane = $('air-scroll');
  if (!lane) return;
  let last = null;

  lane.addEventListener('touchstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const t = e.touches[0];
    last = { x: t.clientX, y: t.clientY };
    lane.classList.add('live');
  }, { passive: false });

  lane.addEventListener('touchmove', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!last || !live()) return;
    const t = e.touches[0];
    const dx = t.clientX - last.x;
    const dy = t.clientY - last.y;
    last = { x: t.clientX, y: t.clientY };
    const p = state.cfg?.pointer || {};
    const dir = p.naturalScroll ? 1 : -1;
    const speed = p.scrollSpeed ?? 1;
    sendScroll(dx * speed * dir, dy * speed * dir);
  }, { passive: false });

  const done = (e) => {
    if (e) e.stopPropagation();
    last = null;
    lane.classList.remove('live');
  };
  lane.addEventListener('touchend', done);
  lane.addEventListener('touchcancel', done);
})();

/** Momentary highlight, so a tap on a button you are not looking at still
 *  registers as having happened. */
function flashPad(id) {
  const b = $(id);
  if (!b) return;
  b.setAttribute('aria-pressed', 'true');
  setTimeout(() => b.setAttribute('aria-pressed', 'false'), 160);
}
$('cols').addEventListener('input', () => {
  state.cfg.board.columns = Number($('cols').value);
  $('out-cols').textContent = state.cfg.board.columns;
  $('colnote').textContent = COL_NOTE[state.cfg.board.columns] || '';
  renderBoard(); saveBoard();
});
$('lefty').addEventListener('change', () => {
  state.lefty = $('lefty').checked;
  document.body.dataset.lefty = state.lefty ? '1' : '0';
  applyPanes();
  // The rotate prompt's wording belongs to applyPlatform, which knows the
  // layout. This copy was stale — it still claimed the phone wants landscape,
  // and being written last it would have won.
  sendState({ t: 'setprefs', prefs: { lefty: state.lefty } });
});
$('gear').addEventListener('click', () => { syncSettings(); openSheet('settings'); });

// ─── Boot ─────────────────────────────────────────────────────────────────

if (!TOKEN) {
  toast('No access token — open the link printed by the Mac');
}
openSocket();
