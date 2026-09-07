// End-to-end protocol tests: the binary hot path and the JSON control
// messages, driven over a real WebSocket against a real running server.
//
// Unlike the console and persistence suites, this one cannot start its own
// server — the point is to exercise a live host, including the exclusive
// control gate and the input helper behind it. Start one first:
//
//   connect
//   TOKEN=$(node -e "console.log(require('./config.json').token)") npm run test:protocol
import { WebSocket } from 'ws';
const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 8787;

// The server can be running in either mode, and a plain-http request to a TLS
// listener just dies with a socket reset — which reads as "the server is
// broken" rather than "wrong scheme". Probe once and speak whichever it is.
async function detectScheme() {
  for (const scheme of ['http', 'https']) {
    try {
      await fetch(`${scheme}://127.0.0.1:${PORT}/whois`);
      return scheme;
    } catch { /* try the other one */ }
  }
  console.error(`\n  \u2717 Nothing is answering on port ${PORT}.`
    + `\n\n    Start a server first:  connect\n`);
  process.exit(1);
}

// A self-signed LAN certificate is the whole point of secure mode, so the test
// client has to accept it the same way tapping through the warning does.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const SCHEME = await detectScheme();
const WSCHEME = SCHEME === 'https' ? 'wss' : 'ws';
const B = `${SCHEME}://127.0.0.1:${PORT}`;
const ok = (n, c) => console.log(`${c ? '✓' : '✗'} ${n}`);
let fails = 0;
const chk = (n, c) => { if (!c) fails++; ok(n, c); };

// HTTP
const r = await fetch(`${B}/`);
const html = await r.text();
chk('serves index.html', r.status === 200 && html.includes('MouseNDeck'));
chk('serves app.js', (await fetch(`${B}/app.js`)).status === 200);
chk('serves manifest', (await fetch(`${B}/manifest.webmanifest`)).status === 200);
chk('serves icon', (await fetch(`${B}/icons/icon-180.png`)).status === 200);
chk('404s unknown path', (await fetch(`${B}/nope`)).status === 404);
const trav = await fetch(`${B}/../package.json`);
chk('blocks path traversal', trav.status === 404 || trav.status === 403);

// WS auth
const bad = await new Promise((res) => {
  const w = new WebSocket(`${WSCHEME}://127.0.0.1:${PORT}/?k=wrong`);
  w.on('open', () => { w.close(); res('opened'); });
  w.on('error', () => res('rejected'));
});
chk('rejects bad token', bad === 'rejected');

// WS good
const ws = new WebSocket(`${WSCHEME}://127.0.0.1:${PORT}/?k=${TOKEN}`);

const got = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout')), 3000);
  ws.on('message', (d, bin) => {
    if (bin) return;
    const msg = JSON.parse(d);
    if (msg.t !== 'hello') return;      // 'busy' may arrive too; we want hello
    clearTimeout(t); res(msg);
  });
  ws.on('error', rej);
});
chk('accepts good token + sends hello', got.t === 'hello');
chk('hello carries board buttons', got.config?.board?.pages?.[0]?.buttons?.length > 0);
chk('hello carries identity', typeof got.identity?.name === 'string' && got.identity.name.length > 0);
chk('hello carries capabilities', Array.isArray(got.capabilities?.actions) && got.capabilities.actions.includes('key'));
chk('gestures tagged native/mapped/none', got.capabilities.gestures.every(g => ['native','mapped','none'].includes(g.mode)));
chk('hello carries discovered peers', Array.isArray(got.peers));
chk('token is NOT leaked to client', got.config?.token === undefined);
chk('reports accessibility state', typeof got.meta?.accessibility === 'string');

// Binary ping/pong round trip
const rtt = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('no pong')), 3000);
  const p = Buffer.alloc(5); p[0] = 6; p.writeUInt32LE(12345, 1);
  const t0 = performance.now();
  ws.on('message', (d, bin) => {
    if (bin && d[0] === 6) {
      clearTimeout(t);
      res({ ms: performance.now() - t0, echo: d.readUInt32LE(1) });
    }
  });
  ws.send(p);
});
chk('binary ping echoes timestamp', rtt.echo === 12345);
console.log(`  loopback round-trip: ${rtt.ms.toFixed(2)} ms`);

// Hot-path opcodes must not throw
const mv = Buffer.alloc(5); mv[0] = 1; mv.writeInt16LE(5, 1); mv.writeInt16LE(-3, 3);
ws.send(mv);
const sc = Buffer.alloc(5); sc[0] = 2; sc.writeInt16LE(0, 1); sc.writeInt16LE(10, 3);
ws.send(sc);
const cl = Buffer.alloc(3); cl[0] = 5; cl[1] = 0; cl[2] = 1;
ws.send(cl);
ws.send(JSON.stringify({ t: 'key', key: 'a', mods: ['cmd'] }));
ws.send(JSON.stringify({ t: 'press', id: got.config.board.pages[0].buttons[0].id }));
await new Promise((r) => setTimeout(r, 400));
chk('survives full opcode sweep', ws.readyState === 1);

// Malformed input must not kill the server
ws.send(Buffer.from([99, 1, 2]));
ws.send('not json{{{');
ws.send(JSON.stringify({ t: 'unknown' }));
await new Promise((r) => setTimeout(r, 300));
chk('ignores malformed input', ws.readyState === 1);
chk('server still serving', (await fetch(`${B}/`)).status === 200);

// ── only one device may drive the Mac at a time ──
const second = new WebSocket(`${WSCHEME}://127.0.0.1:${PORT}/?k=${TOKEN}`);
const secondMsgs = [];
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('second client timeout')), 4000);
  second.on('message', (d, bin) => {
    if (bin) return;
    const m = JSON.parse(d);
    secondMsgs.push(m.t);
    if (m.t === 'busy') { clearTimeout(t); res(); }
  });
  second.on('error', rej);
});
chk('second device is told the Mac is busy', secondMsgs.includes('busy'));
chk('second device still receives hello first', secondMsgs[0] === 'hello');

// Input from the non-holder must be ignored, not queued up.
const mv2 = Buffer.alloc(5); mv2[0] = 1; mv2.writeInt16LE(99, 1); mv2.writeInt16LE(99, 3);
second.send(mv2);
await new Promise((r) => setTimeout(r, 200));
chk('non-holder stays connected after being ignored', second.readyState === 1);

// Taking over is explicit and must work, or a stale tab locks you out.
const granted = await new Promise((res) => {
  second.on('message', (d, bin) => {
    if (!bin && JSON.parse(d).t === 'granted') res(true);
  });
  second.send(JSON.stringify({ t: 'takeover' }));
  setTimeout(() => res(false), 2000);
});
chk('a device can take over control', granted);
second.close();

ws.close();
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
