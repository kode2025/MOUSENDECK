// MOUSENDECK host: serves the PWA over your LAN and streams input events
// from phone/tablet to macOS.
//
// Latency notes — the hot path (pointer moves, scroll) is deliberately
// hostile to anything that adds delay:
//   · Nagle's algorithm is OFF (setNoDelay) — it would otherwise hold small
//     packets for up to 40ms waiting to coalesce them.
//   · WebSocket compression is OFF — pure overhead on 5-byte frames.
//   · Motion arrives as binary, not JSON, so there is no parse step.

import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { networkInterfaces, hostname } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { WebSocketServer } from 'ws';
import qrcode from 'qrcode-terminal';

import { loadConfig, saveConfig, CONFIG_PATH, ROOT } from './config.js';
import { send, checkAccessibility, stopInput } from './input.js';
import { runAction } from './actions.js';
import { capabilities, capsSummary } from './capabilities.js';
import { advertise, browse, list as peerList, discovery, stopDiscovery } from './discovery.js';
import { ensureCert } from './certs.js';

let config = loadConfig();
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || config.port || 8787;

// HTTPS by default. iOS refuses a web page the gyroscope unless the page is a
// secure context, so the air pointer cannot exist over plain http — and having
// to remember a flag to get a feature that is already built is a worse trade
// than the one thing HTTPS costs: a certificate no CA will vouch for on a LAN
// address, and therefore a warning you tap through once per device.
//
// `connect --plain` opts out, for when you want no warning and do not need the
// pointer.
const SECURE = process.env.SECURE === '0' || process.argv.includes('--plain')
  ? false
  : true;
const SCHEME = SECURE ? 'https' : 'http';

/** Interfaces that are never the way a phone reaches this Mac: VPN tunnels,
 *  AirDrop/AWDL, Thunderbolt bridges, virtualisation host-only networks.
 *  Declared up here because secure mode needs the address list before the
 *  server exists, to put the right names in the certificate. */
const DEAD_IF = /^(utun|awdl|llw|bridge|vmnet|vnic|ipsec|gif|stf|anpi)/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// MARK: - HTTP

const json = (res, status, obj) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

async function handleRequest(req, res) {
  const url = new URL(req.url, `${SCHEME}://${req.headers.host}`);
  let path = decodeURIComponent(url.pathname);

  // Lets a client confirm this host is reachable before connecting.
  if (path === '/whois') {
    json(res, 200, {
      name: config.identity.name,
      tag: config.identity.tag,
      os: capabilities().os,
      version: 1,
    });
    return;
  }

  if (path === '/') path = '/index.html';

  // Contain every request inside public/ regardless of ../ tricks.
  const file = join(PUBLIC, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const body = await readFile(file);
    // no-store, not no-cache: "no-cache" still lets a client hold a copy and
    // merely revalidate it, and an iOS home-screen app can hang on to stale
    // app code through a reload — which looks exactly like a fix that did not
    // work. The app is a few hundred KB served over a LAN; re-fetching it
    // costs nothing next to debugging a phantom.
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store, must-revalidate',
      'pragma': 'no-cache',
      'expires': '0',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}

// The addresses the certificate must cover have to be known before the server
// exists, so they are computed here rather than at listen time.
let certInfo = null;
if (SECURE) {
  const names = [bonjourName() + '.local', ...lanAddresses().map((i) => i.address)];
  certInfo = ensureCert(names);
}

const http = SECURE
  ? createHttpsServer({ key: certInfo.key, cert: certInfo.cert }, handleRequest)
  : createHttpServer(handleRequest);

// Every socket, including the one that becomes the WebSocket. On HTTPS this
// fires for the raw TCP socket underneath the TLS session, which is the one
// Nagle would delay.
http.on('connection', (socket) => socket.setNoDelay(true));

/** Is this Origin a LAN address or .local name? Both schemes are allowed: the
 *  page is served over https in secure mode, so its own Origin is https and
 *  refusing it would lock the app out of its own socket. */
function isLanOrigin(origin) {
  let u;
  try { u = new URL(origin); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;

  const h = u.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (h.endsWith('.local')) return true;
  // RFC1918 plus link-local.
  return /^10\./.test(h)
      || /^192\.168\./.test(h)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
      || /^169\.254\./.test(h);
}

// MARK: - WebSocket

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

http.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `${SCHEME}://${req.headers.host}`);

  // The shared token is the only thing standing between your Mac and anyone
  // else on the same Wi-Fi, so reject early and quietly.
  if (url.searchParams.get('k') !== config.token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  // Origin policy. WebSockets are exempt from CORS — a browser will happily
  // let any site open a socket to this port — so the check has to be explicit.
  //
  //   · no Origin header  -> a native app, not a browser. Allowed; it already
  //                          proved possession of the token above.
  //   · plain-http LAN    -> another MouseNDeck host's page. Allowed, so the
  //                          controller can drive more than one machine.
  //   · anything else     -> a real website. Refused, which is what stops a
  //                          malicious page (or DNS rebinding) reaching in.
  const origin = req.headers.origin;
  if (origin && !isLanOrigin(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  socket.setNoDelay(true);
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

// MARK: - Binary hot path
// op 1 move(i16 dx, i16 dy) · 2 scroll(i16,i16) · 3 down(u8) · 4 up(u8)
// 5 click(u8 btn,u8 n) · 6 ping(u32 ts)
const BUTTONS = ['left', 'right', 'middle'];

function handleBinary(ws, buf) {
  switch (buf[0]) {
    case 1: send({ t: 'move', dx: buf.readInt16LE(1), dy: buf.readInt16LE(3) }); break;
    case 2: send({ t: 'scroll', dx: buf.readInt16LE(1), dy: buf.readInt16LE(3) }); break;
    case 3: send({ t: 'down', b: BUTTONS[buf[1]] || 'left' }); break;
    case 4: send({ t: 'up', b: BUTTONS[buf[1]] || 'left' }); break;
    case 5: send({ t: 'click', b: BUTTONS[buf[1]] || 'left', n: buf[2] || 1 }); break;
    case 6: {
      // Echo the client's timestamp straight back for its latency readout.
      const pong = Buffer.allocUnsafe(5);
      pong[0] = 6;
      pong.writeUInt32LE(buf.readUInt32LE(1), 1);
      ws.send(pong);
      break;
    }
  }
}

function findButton(id) {
  for (const page of config.board.pages) {
    const hit = page.buttons.find((b) => b.id === id);
    if (hit) return hit;
  }
  return null;
}

/** Never ship the token back out over the wire. */
function publicConfig() {
  const { token, ...rest } = config;
  return rest;
}

function broadcastConfig(except) {
  const msg = JSON.stringify({ t: 'config', config: publicConfig() });
  for (const c of wss.clients) {
    if (c !== except && c.readyState === 1) c.send(msg);
  }
}

// Exactly one device drives the Mac at a time. Two controllers fighting over
// one pointer is not a feature, and a stale tab left open on another device
// would otherwise quietly steal every gesture.
let holder = null;

/** A readable name for whoever is connected, from the browser's own UA. */
function clientName(req) {
  const ua = req.headers['user-agent'] || '';
  if (/iPad/i.test(ua)) return 'an iPad';
  if (/iPhone/i.test(ua)) return 'an iPhone';
  if (/Android/i.test(ua)) return 'an Android phone';
  if (/Macintosh/i.test(ua)) return 'a Mac';
  return 'another device';
}

function holderInfo() {
  return holder ? { name: holder.mndName, address: holder.mndAddr } : null;
}

wss.on('connection', (ws, req) => {
  const who = req.socket.remoteAddress?.replace('::ffff:', '') || '?';
  ws.mndAddr = who;
  ws.mndName = clientName(req);
  ws.mndSince = Date.now();

  // Reclaim the slot if the previous holder has gone away.
  if (holder && holder.readyState !== 1) holder = null;

  const takesControl = !holder;
  if (takesControl) {
    holder = ws;
    console.log(`  ✓ ${ws.mndName} connected  ${who}  — now in control`);
  } else {
    console.log(`  · ${ws.mndName} connected  ${who}  — read-only, ${holder.mndName} holds control`);
  }

  // Everything the client needs to render a board it can trust: who this
  // machine is, what it can actually do, and its saved buttons.
  ws.send(JSON.stringify({
    t: 'hello',
    identity: { ...config.identity, id: `${bonjourName()}.local:${PORT}` },
    capabilities: capabilities(),
    config: publicConfig(),
    peers: peerList(),
    meta: { accessibility: checkAccessibility() },
  }));

  // Told after the greeting, so the interface is already rendered behind the
  // lock screen and taking over does not need a reload.
  if (!takesControl) {
    ws.send(JSON.stringify({ t: 'busy', holder: holderInfo() }));
  }

  ws.on('message', async (raw, isBinary) => {
    // Binary is nothing but pointer traffic, so a non-holder is simply ignored
    // — except for its latency probe, which is harmless and keeps its readout
    // alive while it waits.
    if (isBinary) {
      if (ws === holder || raw[0] === 6) handleBinary(ws, raw);
      return;
    }

    let m;
    try { m = JSON.parse(raw); } catch { return; }

    // Taking over is deliberate and explicit, so a device is never locked out
    // by a tab someone forgot to close.
    if (m.t === 'takeover') {
      const previous = holder;
      holder = ws;
      if (previous && previous !== ws && previous.readyState === 1) {
        previous.send(JSON.stringify({ t: 'released', by: ws.mndName }));
      }
      ws.send(JSON.stringify({ t: 'granted' }));
      console.log(`  ⇄ control taken by ${ws.mndName}  ${ws.mndAddr}`);
      return;
    }

    const CONTROL = new Set(['moveto', 'key', 'text', 'press', 'action']);
    if (CONTROL.has(m.t) && ws !== holder) return;

    switch (m.t) {
      case 'moveto': send({ t: 'moveto', x: m.x, y: m.y }); break;
      case 'key':    send({ t: 'key', key: m.key, mods: m.mods || [] }); break;
      case 'text':   send({ t: 'text', s: m.s }); break;

      // Failures come back to the device that pressed the button. Without
      // this the tile pulses green either way and a permission problem on the
      // Mac looks like a broken button on the iPad.
      case 'press': {
        const b = findButton(m.id);
        if (!b) break;
        const r = await runAction(b.action);
        if (!r?.ok) {
          ws.send(JSON.stringify({ t: 'failed', id: m.id, label: b.label, error: r?.error }));
        }
        break;
      }

      case 'action': {
        const r = await runAction(m.action);
        if (!r?.ok) ws.send(JSON.stringify({ t: 'failed', error: r?.error }));
        break;
      }

      case 'setpointer':
        config.pointer = { ...config.pointer, ...(m.pointer || {}) };
        saveConfig(config);
        broadcastConfig(ws);
        break;

      // One channel for the small UI preferences, so every one of them
      // persists and is shared by whatever device connects next.
      case 'setprefs': {
        const prefs = m.prefs || {};
        if (typeof prefs.lefty === 'boolean') config.lefty = prefs.lefty;
        if (Array.isArray(prefs.customs)) config.customs = prefs.customs;
        saveConfig(config);
        broadcastConfig(ws);
        break;
      }

      case 'setplatform':
        if (m.platform === 'macos' || m.platform === 'windows') {
          config.platform = m.platform;
          saveConfig(config);
          broadcastConfig(ws);
        }
        break;

      case 'setboard':
        if (m.board?.pages) {
          config.board = m.board;
          saveConfig(config);
          broadcastConfig(ws);
        }
        break;

      case 'rescan':
        ws.send(JSON.stringify({ t: 'peers', peers: peerList() }));
        break;
    }
  });

  ws.on('close', () => {
    console.log(`  · ${ws.mndName} disconnected  ${who}`);
    if (holder === ws) {
      holder = null;
      // Offer the slot to whoever is still waiting.
      for (const c of wss.clients) {
        if (c.readyState === 1) {
          holder = c;
          c.send(JSON.stringify({ t: 'granted' }));
          console.log(`  ⇄ control passed to ${c.mndName}  ${c.mndAddr}`);
          break;
        }
      }
    }
  });
});

// MARK: - Startup banner

/** The interface carrying the default route — i.e. the one actually in use.
 *  Node's interface order is arbitrary, so on a Mac with a VPN up, or one that
 *  has held several addresses, "the first one" is a coin flip. */
function defaultRouteIface() {
  try {
    const out = execFileSync('route', ['-n', 'get', 'default'], { encoding: 'utf8' });
    return out.match(/interface:\s*(\S+)/)?.[1] || null;
  } catch {
    return null;
  }
}

/** Every address a phone could plausibly use, best first. */
function lanAddresses() {
  const primary = defaultRouteIface();
  const out = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (DEAD_IF.test(name)) continue;
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue;   // self-assigned, unroutable
      out.push({ name, address: a.address, primary: name === primary });
    }
  }
  // The default-route interface first; everything else after, in order.
  return out.sort((a, b) => (b.primary === true) - (a.primary === true));
}

/** iOS Personal Hotspot always hands out 172.20.10.x with the phone on .1.
 *  Worth naming, because "am I on the same Wi-Fi?" has a surprising answer
 *  when the phone you are controlling from *is* the network. */
const isHotspot = (ip) => /^172\.20\.10\./.test(ip);

function bonjourName() {
  try {
    return execFileSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' }).trim();
  } catch {
    return hostname().replace(/\.local$/, '');
  }
}

discovery.on('peers', (peers) => {
  const msg = JSON.stringify({ t: 'peers', peers });
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
});

const RULE = '─'.repeat(52);

/** The address the QR points at, and the other ways in. Filled in on listen. */
let link = { url: '', local: '', alts: [] };

function printLink(withQR) {
  console.log('');
  if (withQR) {
    qrcode.generate(link.url, { small: true }, (qr) => {
      console.log(qr.split('\n').map((l) => `  ${l}`).join('\n'));
    });
  }
  console.log(`  ${link.url}`);
  // The numeric address changes whenever the network does — moving between
  // Wi-Fi and a hotspot is enough. A Home Screen icon saved against the old
  // one just spins forever, because the page it points at never loads and no
  // code of ours ever gets to run. The .local name follows the Mac instead.
  if (link.local) {
    console.log('');
    console.log(`  Keeping it on the Home Screen? Use this one instead — it keeps`);
    console.log(`  working when the address changes:`);
    console.log(`    ${link.local}`);
  }
  if (link.alts.length) {
    console.log('');
    console.log(`  also reachable at:`);
    for (const u of link.alts) console.log(`    ${u}`);
  }
  console.log('');
}

http.listen(PORT, '0.0.0.0', () => {
  const access = checkAccessibility();
  const local = `${bonjourName()}.local`;

  // Publish ourselves, and watch for other machines running a host.
  advertise({
    name: config.identity.name,
    tag: config.identity.tag,
    port: PORT,
    os: capabilities().os,
    caps: capsSummary().split(','),
  });
  browse();

  // Prefer a routable address for the QR: a phone camera cannot resolve .local
  // reliably on every network. The .local name is offered alongside because it
  // is the one that survives the address changing.
  const ifs = lanAddresses();
  const best = ifs[0]?.address || local;
  link.url = `${SCHEME}://${best}:${PORT}/?k=${config.token}`;
  link.local = `${SCHEME}://${local}:${PORT}/?k=${config.token}`;
  link.alts = ifs.slice(1).map((i) => `${SCHEME}://${i.address}:${PORT}/?k=${config.token}  (${i.name})`);

  console.log(`\n  MOUSENDECK`);
  console.log(`  ${RULE}`);
  console.log(`  Point your iPad or phone camera at this:`);
  printLink(true);

  if (SECURE) {
    console.log(`  🔒 Secure mode: this certificate is self-signed, because no`);
    console.log(`     authority will vouch for a LAN address. Your phone will warn`);
    console.log(`     you once — tap Show Details, then "visit this website".`);
    console.log(`     This is what unlocks the gyroscope pointer; iOS refuses it`);
    console.log(`     to any page that is not a secure context.`);
    console.log('');
  }
  if (isHotspot(best)) {
    console.log(`  You are on an iPhone Personal Hotspot. That counts as the same`);
    console.log(`  network — the phone sharing it can control this Mac too.`);
  }
  console.log(`  Tap Share → "Add to Home Screen" for a fullscreen icon.`);
  console.log(`  Type  show connected device  here to see who is on.`);
  console.log(`  Ctrl-C here stops it. Nothing is left running.`);

  // macOS records a "responsible process" when this one is launched, and every
  // permission prompt — Accessibility, Screen Recording, Automation — is
  // attributed to THAT app, not to this script. Started from your Terminal,
  // the prompts say Terminal and the grants stick to it. Started by some other
  // tool (an editor's task runner, an agent, a launcher), the prompts name
  // that tool instead, and granting them does nothing for a later run from a
  // real terminal. That is a genuinely confusing hour to lose, so say it here.
  if (!process.stdout.isTTY) {
    console.log(`\n  ⚠  Not started from a terminal.`);
    console.log(`     macOS will attribute permission prompts to whatever launched`);
    console.log(`     this, not to your Terminal — so a screen-recording prompt may`);
    console.log(`     name the wrong app, and granting it will not help next time.`);
    console.log(`     For permissions to belong to you, run it yourself:`);
    console.log(`         connect`);
  }

  if (access !== 'trusted') {
    console.log(`\n  ⚠  Accessibility is NOT granted, so the pointer and keys`);
    console.log(`     will not move. Grant it to the app running this server`);
    console.log(`     (Terminal or iTerm), then quit that app fully and rerun:`);
    console.log(`     System Settings → Privacy & Security → Accessibility`);
  } else {
    console.log(`\n  ✓ Accessibility granted — pointer and keys will work.`);
  }
  console.log(`  ${RULE}\n`);

  startConsole();
  watchAddress();
});

// The address is the single most common thing to go wrong, and it goes wrong
// silently: you move between Wi-Fi and a hotspot, the Mac takes a new address,
// and the QR on screen now points nowhere. The phone just spins, because the
// page never loads and none of the app's code gets to run and say why. So
// watch for it and reprint, unprompted.
function watchAddress() {
  let current = lanAddresses()[0]?.address || null;

  setInterval(() => {
    const next = lanAddresses()[0]?.address || null;
    if (next === current) return;

    const was = current;
    current = next;

    if (!next) {
      console.log(`\n  ⚠  This Mac has gone offline — was ${was}.`);
      console.log(`     Nothing can reach it until the network is back.\n`);
      return;
    }

    // Rebuild the link before printing, or the QR would still encode the old
    // address it is warning you about.
    const ifs = lanAddresses();
    link.url = `http://${next}:${PORT}/?k=${config.token}`;
    link.alts = ifs.slice(1).map((i) => `${SCHEME}://${i.address}:${PORT}/?k=${config.token}  (${i.name})`);

    console.log(`\n  ${RULE}`);
    console.log(`  ⚠  This Mac's address changed: ${was || 'offline'} → ${next}`);
    console.log(`     Any QR you already scanned points at the old one. Here is a`);
    console.log(`     current code — rescan it on the device.`);
    if (isHotspot(next)) {
      console.log(`     (That is an iPhone Personal Hotspot. The phone sharing it can`);
      console.log(`      control this Mac.)`);
    }
    printLink(true);
    console.log(`  ${RULE}\n`);
  }, 3000).unref();
}

// MARK: - Terminal console
// `connect` already runs in the foreground, so the terminal it is holding is
// the obvious place to ask it questions. Typing a line here answers without a
// second window, a second tool, or anything extra left running.

/** "12:04" / "1:02:33" since a timestamp. */
function fmtSince(at) {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

function printDevices() {
  const clients = [...wss.clients].filter((c) => c.readyState === 1);
  console.log('');
  if (!clients.length) {
    console.log(`  Nothing is connected right now.`);
    console.log(`  Scan the QR code on the device you want to use — type  qr  to reprint it.`);
    console.log('');
    return;
  }

  // The holder first: it is the one actually driving the Mac, and on a busy
  // network the list can be several stale tabs deep.
  const rows = clients
    .sort((a, b) => (b === holder) - (a === holder) || a.mndSince - b.mndSince)
    .map((c) => ({
      lead: c === holder ? '▶' : ' ',
      name: c.mndName,
      addr: c.mndAddr,
      role: c === holder ? 'in control' : 'watching',
      since: fmtSince(c.mndSince),
    }));
  // Columns are measured, not fixed: names and addresses vary enough that a
  // hard-coded width goes ragged the moment a phone joins an iPad.
  const wide = (k) => Math.max(...rows.map((r) => r[k].length));
  const [wn, wa, wr] = [wide('name'), wide('addr'), wide('role')];

  console.log(rows.length === 1 ? `  Connected device` : `  Connected devices (${rows.length})`);
  console.log(`  ${RULE}`);
  for (const r of rows) {
    console.log(`  ${r.lead} ${r.name.padEnd(wn)}   ${r.addr.padEnd(wa)}   ` +
                `${r.role.padEnd(wr)}   for ${r.since}`);
  }
  console.log('');
}

function printHelp() {
  console.log(`
  Commands
  ${RULE}
    show connected device   who is connected, and which one is driving
    url                     print the link again
    qr                      print the QR code again
    address                 re-check this Mac's addresses after a network change
    accessibility           re-check whether input is permitted
    help                    this list
    quit                    stop the server (same as Ctrl-C)
`);
}

function shutdown() {
  console.log('\n  shutting down…');
  stopInput();
  stopDiscovery();
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
}

function startConsole() {
  // terminal:false keeps readline out of the way: no echo of its own on top of
  // the shell's, and Ctrl-C stays with our own SIGINT handler.
  const rl = createInterface({ input: process.stdin, terminal: false });

  rl.on('line', (raw) => {
    const cmd = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!cmd) return;

    if (/^(show( connected)?( devices?)?|devices?|connected|who|status)$/.test(cmd)) {
      printDevices();
    } else if (cmd === 'url' || cmd === 'link') {
      printLink(false);
    } else if (cmd === 'qr' || cmd === 'code') {
      printLink(true);
    } else if (cmd === 'address' || cmd === 'addresses' || cmd === 'ip') {
      // Recomputed live, not read from the startup banner: the whole point is
      // that you are asking because the network changed under it.
      const ifs = lanAddresses();
      console.log('');
      if (!ifs.length) {
        console.log(`  This Mac has no network address right now — it is offline.`);
      } else {
        console.log(`  This Mac is reachable at`);
        console.log(`  ${RULE}`);
        for (const i of ifs) {
          console.log(`  ${i.primary ? '▶' : ' '} ${i.address.padEnd(15)} ${i.name}`
            + `${i.primary ? '   ← the one in use' : ''}`);
        }
        console.log(`    ${bonjourName()}.local   follows this Mac across networks`);
        if (isHotspot(ifs[0].address)) {
          console.log('');
          console.log(`  That is an iPhone Personal Hotspot. It counts as the same network,`);
          console.log(`  and the phone providing it can control this Mac.`);
        }
        if (ifs[0].address !== link.url.match(/\/\/([^:]+)/)?.[1]) {
          console.log('');
          console.log(`  ⚠  This is not the address in the QR code printed earlier.`);
          console.log(`     Type  qr  for a current one, and rescan on the device.`);
        }
      }
      console.log('');
    } else if (cmd === 'accessibility' || cmd === 'access') {
      const a = checkAccessibility();
      console.log(a === 'trusted'
        ? `\n  ✓ Accessibility granted — pointer and keys will work.\n`
        : `\n  ⚠ Accessibility is NOT granted (${a}) — pointer and keys will not move.\n`);
    } else if (cmd === 'help' || cmd === '?') {
      printHelp();
    } else if (/^(quit|exit|stop|disconnect|q)$/.test(cmd)) {
      shutdown();
    } else {
      console.log(`  "${raw.trim()}" is not a command here — type  help  for the list.`);
    }
  });

  // stdin closing (backgrounded, or the terminal went away) is not an error;
  // the server carries on serving.
  rl.on('close', () => {});
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, shutdown);
