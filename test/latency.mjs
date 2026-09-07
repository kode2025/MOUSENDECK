// What the wire actually costs, measured rather than asserted.
//
// Starts a real server on a spare port, both schemes, and times the real op-6
// latency probe — the same one the header readout uses. Everything is on
// loopback, so what comes out is the SOFTWARE floor: your Wi-Fi hop is added
// on top of it. That separation is the point. If this prints a fraction of a
// millisecond and your iPad shows 20 ms, the 20 ms is the network and the
// touchscreen, and no amount of tuning in this repo will move it.
//
//   npm run bench
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { loadConfig } from '../host/config.js';

// The certificate is self-signed by definition; this client has to accept it.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const TOKEN = loadConfig().token;
const ROOT = new URL('..', import.meta.url).pathname;
const PROBES = Number(process.env.PROBES || 400);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function measure(secure, port) {
  const srv = spawn('node', ['host/server.js', ...(secure ? [] : ['--plain'])], {
    cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: 'ignore',
  });
  // Secure mode may have to generate a certificate on a cold run.
  await wait(secure ? 2200 : 1200);

  const ws = new WebSocket(`${secure ? 'wss' : 'ws'}://127.0.0.1:${port}/?k=${TOKEN}`,
    { rejectUnauthorized: false });
  try {
    await new Promise((ok, no) => { ws.once('open', ok); ws.once('error', no); });
  } catch (err) {
    srv.kill();
    throw new Error(`could not connect over ${secure ? 'wss' : 'ws'}: ${err.message}`);
  }

  const T0 = performance.now();
  const samples = [];
  // The probe carries its own timestamp and the host echoes it back verbatim,
  // so two probes in flight at once cannot mis-measure each other.
  ws.on('message', (d, isBinary) => {
    if (isBinary && d[0] === 6) samples.push((performance.now() - T0) - d.readUInt32LE(1));
  });

  const b = Buffer.alloc(5);
  b[0] = 6;
  for (let i = 0; i < PROBES; i++) {
    b.writeUInt32LE(Math.round(performance.now() - T0) >>> 0, 1);
    ws.send(b);
    await wait(4);
  }
  await wait(250);
  ws.close();
  srv.kill();
  await wait(300);

  samples.sort((a, x) => a - x);
  const at = (p) => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))];
  return { n: samples.length, p50: at(0.5), p95: at(0.95), max: samples.at(-1) ?? 0 };
}

const plain = await measure(false, 8901);
const tls = await measure(true, 8902);

const row = (label, r) =>
  `  ${label.padEnd(26)} ${r.p50.toFixed(2).padStart(6)}  ${r.p95.toFixed(2).padStart(6)}  ` +
  `${r.max.toFixed(2).padStart(6)}   (${r.n} probes)`;

console.log(`\n  Round trip through the real server, loopback`);
console.log(`  ${'─'.repeat(66)}`);
console.log(`  ${''.padEnd(26)} ${'p50'.padStart(6)}  ${'p95'.padStart(6)}  ${'worst'.padStart(6)}`);
console.log(row('ws://   (connect --plain)', plain));
console.log(row('wss://  (connect)', tls));
console.log(`\n  TLS costs ${(tls.p50 - plain.p50).toFixed(2)} ms at the median.`);
console.log(`\n  For scale: an iPad 9 samples touch every 16.70 ms, and that frame is`);
console.log(`  the floor for how fast any movement can possibly feel.\n`);

let fails = 0;
const chk = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? '✓' : '✗'} ${name}${extra}`); };
chk('the software path is under 2 ms at the median', tls.p50 < 2, `  → ${tls.p50.toFixed(2)} ms`);
chk('…and under 5 ms at p95', tls.p95 < 5, `  → ${tls.p95.toFixed(2)} ms`);
chk('TLS costs less than one touch frame', (tls.p50 - plain.p50) < 16.7,
  `  → ${(tls.p50 - plain.p50).toFixed(2)} ms`);
console.log(fails ? `\n${fails} FAILED\n` : '\nALL PASS\n');
process.exit(fails ? 1 : 0);
