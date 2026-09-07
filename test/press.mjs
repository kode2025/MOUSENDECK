// Presses one board button through the real server, exactly as the iPad does.
// A hand tool for checking a single shortcut without picking up the iPad:
//   node test/press.mjs Finder
import { WebSocket } from 'ws';
import { loadConfig } from '../host/config.js';

const cfg = loadConfig();
const want = process.argv[2];
const PORT = process.env.PORT || 8787;

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?k=${cfg.token}`);
ws.on('open', () => {});
ws.on('message', (d, bin) => {
  if (bin) return;
  const m = JSON.parse(d);
  if (m.t !== 'hello') return;
  const all = m.config.board.pages.flatMap((p) => p.buttons);
  const hit = all.find((b) => b.id === want || b.label?.toLowerCase() === want.toLowerCase());
  if (!hit) {
    console.log('no such button. available:', all.map((b) => b.label).join(', '));
    process.exit(1);
  }
  console.log(`pressing "${hit.label}" -> ${JSON.stringify(hit.action)}`);
  ws.send(JSON.stringify({ t: 'takeover' }));
  setTimeout(() => ws.send(JSON.stringify({ t: 'press', id: hit.id })), 150);
  setTimeout(() => { ws.close(); process.exit(0); }, 1600);
});
