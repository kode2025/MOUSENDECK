// Bonjour advertise + browse.
//
// Safari cannot do mDNS, so the host discovers peers on the LAN and relays the
// list to the iPad over the WebSocket it is already holding open. Each host
// advertises its capability set in TXT records, which is what lets the client
// refuse to add a button the target cannot perform.
//
// Uses the dns-sd(1) CLI rather than a native module: it ships with macOS and
// keeps this dependency-free. Output format verified against dns-sd on
// macOS 26.

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

const SERVICE = '_mousendeck._tcp';

export const discovery = new EventEmitter();

let advertiseProc = null;
let browseProc = null;
const peers = new Map();      // instance name -> record
const resolvers = new Map();  // instance name -> child process

/** Publish this host so other devices can find it. */
export function advertise({ name, tag = '', port, os = 'macos', caps = [], version = 1 }) {
  stopAdvertise();
  const txt = [`os=${os}`, `ver=${version}`, `tag=${tag}`, `caps=${caps.join(',')}`];
  advertiseProc = spawn('dns-sd', ['-R', name, SERVICE, 'local', String(port), ...txt], {
    stdio: 'ignore',
  });
  advertiseProc.on('error', (e) => console.error(`[discovery] advertise: ${e.message}`));
}

export function stopAdvertise() {
  advertiseProc?.kill();
  advertiseProc = null;
}

/**
 * dns-sd -L prints the endpoint and TXT on separate lines, e.g.
 *   Name._mousendeck._tcp.local. can be reached at Host.local.:8787 (interface 11)
 *    os=macos ver=1 caps=key,text,media
 */
function resolve(instance) {
  if (resolvers.has(instance)) return;
  const p = spawn('dns-sd', ['-L', instance, SERVICE, 'local']);
  resolvers.set(instance, p);

  let pendingHost = null;
  p.stdout.on('data', (chunk) => {
    for (const line of String(chunk).split('\n')) {
      const at = line.match(/can be reached at\s+(\S+?)\.?:(\d+)/);
      if (at) {
        pendingHost = { host: at[1].replace(/\.$/, ''), port: Number(at[2]) };
        continue;
      }
      if (pendingHost && /\b\w+=/.test(line)) {
        const txt = Object.fromEntries(
          line.trim().split(/\s+/)
            .map((kv) => kv.split('='))
            .filter((kv) => kv.length === 2)
        );
        peers.set(instance, {
          id: `${pendingHost.host}:${pendingHost.port}`,
          name: instance,
          tag: txt.tag || '',
          host: pendingHost.host,
          port: pendingHost.port,
          os: txt.os || 'unknown',
          version: Number(txt.ver) || 0,
          caps: (txt.caps || '').split(',').filter(Boolean),
        });
        pendingHost = null;
        emit();
      }
    }
  });
  p.on('error', () => {});
}

let emitTimer = null;
function emit() {
  // dns-sd chatters on startup; collapse the burst into one update.
  clearTimeout(emitTimer);
  emitTimer = setTimeout(() => discovery.emit('peers', list()), 150);
}

export function list() {
  return [...peers.values()];
}

/** Watch the LAN for other hosts. */
export function browse() {
  if (browseProc) return;
  browseProc = spawn('dns-sd', ['-B', SERVICE, 'local']);

  browseProc.stdout.on('data', (chunk) => {
    for (const line of String(chunk).split('\n')) {
      // Timestamp  A/R  Flags  if  Domain  ServiceType  InstanceName
      const m = line.match(/^\d[\d:.]*\s+(Add|Rmv)\s+\d+\s+\d+\s+\S+\s+\S+\s+(.+?)\s*$/);
      if (!m) continue;
      const [, action, instance] = m;
      if (action === 'Add') {
        resolve(instance);
      } else {
        peers.delete(instance);
        resolvers.get(instance)?.kill();
        resolvers.delete(instance);
        emit();
      }
    }
  });
  browseProc.on('error', (e) => console.error(`[discovery] browse: ${e.message}`));
}

export function stopDiscovery() {
  stopAdvertise();
  browseProc?.kill();
  browseProc = null;
  for (const p of resolvers.values()) p.kill();
  resolvers.clear();
  peers.clear();
}
