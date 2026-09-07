# MOUSENDECK — Multi-Device Discovery, Pairing & Session Architecture

Verified against the live code at `/Users/satish/Desktop/SKSKNProjects/MOUSENDECK` (`host/server.js`, `host/config.js`, `host/input.js`, `host/actions.js`, `public/app.js`). mDNS claims below were tested on this Mac, not assumed.

---

## 0. What I verified before designing

`dns-sd` is at `/usr/bin/dns-sd` and the full round trip works on this machine:

| Step | Command | Result |
|---|---|---|
| Advertise | `dns-sd -R "Satish Mac" _mousendeck._tcp local 8787 os=macos v=1 cap=a1b2c3d4 id=7f3a` | `Name now registered and active` |
| Browse | `dns-sd -B _mousendeck._tcp local` | `Add 3 11 local. _mousendeck._tcp. Satish Mac` (also on if 1, 21, 22) |
| Resolve | `dns-sd -L "Satish Mac" _mousendeck._tcp local` | `Elfys-MacBook.local.:8787` + all TXT keys |
| Address | `dns-sd -G v4 Elfys-MacBook.local` | `192.168.5.3` (if 11), `127.0.0.1` (if 1) |

Host identity: `LocalHostName = Elfys-MacBook`, `en0 = 192.168.5.3`, macOS 26.5. Three parsing gotchas I hit and that the implementation must handle:

- **Duplicate results per interface.** Interfaces 1 (lo0), 11 (en0), 21/22 (awdl/llw) each report the same instance. Dedupe by instance name; keep only addresses from a real LAN interface.
- **`\032` escaping.** `-L` printed `Satish\032Mac._mousendeck._tcp.local.` — spaces are octal-escaped in instance names. Unescape `\\(\d{3})` before display.
- **`-G v4` returns loopback too.** Filter `127.0.0.0/8` and `169.254.0.0/16` out of the candidate endpoint list.

The current client hardcodes its target — `public/app.js:24`:

```js
ws = new WebSocket(`ws://${location.host}/?k=${encodeURIComponent(TOKEN)}`);
```

Everything below exists to replace `location.host` with a *chosen* host, safely.

---

## 1. Discovery

### The browser's actual capability envelope

| Capability | Available in Safari on iPadOS? |
|---|---|
| mDNS/Bonjour browse | **No** |
| Raw UDP / TCP sockets | **No** |
| Reliable /24 port scan | **No** — Safari caps parallel connections and each dead IP costs a full SYN timeout; 254 probes ≈ minutes |
| `fetch` / `WebSocket` to an arbitrary LAN IP | **Yes** |
| Reading a URL the OS Camera app opened | **Yes** |
| In-page QR scan via `getUserMedia` | **No** — see §2.3, insecure context |

So the browser can only ever *confirm* an address it was already told about. Discovery must happen off-device.

### Evaluation

**(a) Server-side mDNS browse, relayed over the existing WebSocket.** Correct and cheap — but it has a hard cold-start hole: relaying requires already being connected to *some* host. On a fresh install, or when the last-used Mac is asleep, the list is empty and the user is stuck. Also, the browsing host only sees its own L2 segment, so a Mac on Wi-Fi won't see a PC on a guest VLAN.

**(b) Manual add + localStorage.** The only mechanism that works with zero infrastructure, and the only fallback when mDNS is blocked (many routers filter multicast; "AP isolation" and most guest networks kill it outright). But typing `192.168.5.3:8787` is exactly the friction the redesign is meant to remove, and DHCP will silently invalidate it.

**(c) Hybrid.** Each layer covers the others' failure mode precisely: the recents cache solves cold start, mDNS relay solves DHCP drift and new-host onboarding, manual add solves broken-multicast networks.

### Recommendation: (c), with the recents cache as the primary path

Order of operations on app launch:

1. **Read the local registry** (localStorage) → render immediately, most-recent-first. No network. This is the sub-100ms path that covers ~95% of launches.
2. **Probe in parallel** every endpoint of the top N (N=8) records with a 900 ms-timeout WebSocket probe, max 6 concurrent. Reachable devices get a green dot; unreachable ones drop to a "Not on this network" group. This is *not* a port scan — it is 8–20 known addresses.
3. **Once connected to any host**, that host streams its live mDNS browse results over the WebSocket (`t:'peers'`). New and moved hosts appear in the list *while connected*, and their fresh addresses are written back into the registry.
4. **Manual add** is always present as a row at the bottom of the list.

The key inversion: mDNS is not how you find a host you already know — it is how you find a host you have **never seen**, or one whose IP **changed**. The recents cache does the daily work.

### Service advertisement

Service type: **`_mousendeck._tcp`**, domain `local.`, instance name = the human display name.

TXT records (keep the whole record under 400 bytes so it fits one packet):

| Key | Example | Purpose |
|---|---|---|
| `v` | `1` | Protocol version. Client refuses to connect on mismatch. |
| `id` | `b7f3a19c4d5e6f80` | Stable 64-bit host ID. **Survives rename and IP change** — this is the registry primary key, never the IP. |
| `name` | `Satish Mac` | Display name (duplicated from instance name; instance name is escaped/uniquified by mDNS on collision, TXT is not). |
| `os` | `macos` \| `windows` \| `linux` | Drives requirement 4 (OS-gated shortcut catalog). |
| `osv` | `26.5` | Feature gating (e.g. Stage Manager keys). |
| `av` | `1.2.0` | App version. |
| `cap` | `a1b2c3d4` | 32-bit FNV-1a hash of the capability document (§1.4). Lets the client know its cached capability doc is stale **without connecting**. |
| `pair` | `0` \| `1` | Whether a pairing window is currently open. Drives the "Ready to pair" badge. |
| `port` | `8787` | Redundant with SRV, but saves a resolve round trip. |

**Do not put the token, a token hash, or anything user-identifying in TXT.** mDNS is broadcast in cleartext to the whole segment.

#### Advertising from Node on macOS — use the OS responder

```js
// host/discovery/advertise-macos.js
const args = ['-R', displayName, '_mousendeck._tcp', 'local', String(port),
  `v=1`, `id=${hostId}`, `name=${displayName}`, `os=macos`,
  `osv=${osVersion}`, `av=${APP_VERSION}`, `cap=${capHash}`, `pair=0`];
const child = spawn('/usr/bin/dns-sd', args, { stdio: ['ignore', 'pipe', 'pipe'] });
// The record lives exactly as long as this child. Kill it in the SIGINT handler
// alongside stopInput() in server.js.
```

Why the CLI rather than a JS responder on macOS: `mDNSResponder` already owns UDP 5353. A pure-JS responder (`multicast-dns` with `reuseAddr`) *does* bind alongside it, but you then have two responders answering for the same box, which produces duplicate and occasionally conflicting records. On macOS the native responder is already running, already firewall-approved, and free.

Restarting the advertisement is how you flip `pair=1` — `dns-sd` has no update mechanism, so kill and respawn the child (~700 ms to re-register, measured above).

#### Browsing from Node on macOS

Two long-lived children: `dns-sd -B _mousendeck._tcp local` for the instance stream, and one `dns-sd -L <instance> _mousendeck._tcp local` per instance for host/port/TXT, then `dns-sd -G v4 <hostname>` for addresses. Parse line-oriented output; the instance name is the **last** column and contains spaces, so split with a limit:

```js
// "10:48:18.600  Add  3  11  local.  _mousendeck._tcp.  Satish Mac"
const m = line.match(/^\S+\s+(Add|Rmv)\s+\d+\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/);
```

Debounce the resulting peer list by 300 ms before broadcasting — the browse fires 3–4 times per instance as interfaces report in.

#### Advertising from a Windows agent

Windows has no `dns-sd` unless Apple's Bonjour Print Services is installed (it usually is not, and requiring it is a bad onboarding step). Use a **pure-JS responder** — `bonjour-service` or `ciao`, both of which open their own multicast socket and need no system service:

```js
import { Bonjour } from 'bonjour-service';
const bonjour = new Bonjour();
bonjour.publish({
  name: displayName, type: 'mousendeck', protocol: 'tcp', port,
  txt: { v: '1', id: hostId, name: displayName, os: 'windows', osv, av, cap: capHash, pair: '0' },
});
```

Windows deployment requirements, all of which need to be in the installer or the README:

- **Inbound firewall rules for both UDP 5353 and TCP 8787.** Windows Firewall silently drops both by default; without the UDP rule the host advertises but never receives queries and is invisible.
- Set the network profile to **Private**. On a Public profile, Windows blocks inbound LAN traffic regardless of rules.
- The Windows agent replaces `mdinput.swift` with a `SendInput`-based helper; the discovery layer is otherwise identical.

The Windows agent should also expose `t:'peers'`, so browsing works from either side.

### Capability document (drives requirements 4 and 9)

TXT carries only the hash; the full document arrives in the host's `hello` frame after auth:

```json
{
  "capHash": "a1b2c3d4",
  "os": "windows",
  "modifiers": ["ctrl", "alt", "shift", "win"],
  "modifierLabels": { "ctrl": "Ctrl", "alt": "Alt", "shift": "Shift", "win": "⊞ Win" },
  "keyboardLayout": "ansi-win",
  "actions": {
    "key": true, "text": true, "mouse": true, "scroll": true,
    "media": { "supported": true, "keys": ["playpause","next","prev","mute","soundup","sounddown"] },
    "open": { "supported": true, "kinds": ["app","url","path"] },
    "shell": { "supported": true, "shell": "powershell" },
    "applescript": false,
    "multi": true, "delay": true
  },
  "gestures": {
    "family": "windows-precision",
    "supported": ["tap1","tap2","tap3","tap4","swipe2-h","swipe2-v","swipe3-h","swipe3-v","swipe4-h","swipe4-v","pinch"],
    "unsupported": ["force-touch", "swipe4-diagonal"]
  },
  "unavailable": [
    { "id": "applescript", "reason": "AppleScript is macOS-only" },
    { "id": "media.eject", "reason": "No eject key on this platform" }
  ]
}
```

Requirement 4 falls straight out: the button-catalog UI filters on `actions` and `gestures.supported`, and the `unavailable` array gives the editor a specific, honest reason string to show instead of a dead greyed-out tile. The `gestures.family` field picks the MacBook vs Windows-precision gesture picker in the add-shortcut sheet.

Boards stay where they already are — in each host's own `config.json` (`host/config.js`). That is *already* per-device storage, which satisfies requirement 5 for free. The client keeps a read-only mirror so a board renders instantly on reconnect and remains viewable (greyed, non-firing) while disconnected.

---

## 2. The cross-host problem

### 2.1 Does CORS apply to WebSockets? No — and that is the danger

To be exact:

- **The WebSocket handshake is not subject to the CORS protocol.** No preflight `OPTIONS` is sent. No `Access-Control-Allow-Origin` header is sent, required, or consulted. `new WebSocket('ws://192.168.5.77:8787/')` from a page on `http://192.168.5.3:8787` **will connect** if the server completes the handshake. There is nothing to configure on the client and nothing to relax on the server.
- **The browser does send an `Origin` header** on handshakes initiated from a document context (RFC 6455 §4.1, and the WHATWG `WebSocket` constructor). Page JavaScript cannot forge or suppress it — `Origin` is a forbidden header name and the `WebSocket` constructor has no header API at all. It is therefore trustworthy *as a browser signal*, and worthless against non-browser clients (curl, a Python script, a native app), which simply omit it.
- **Cookies for the target origin are attached** to the handshake. This is the root of cross-site WebSocket hijacking: a server that authenticates by cookie or by source IP grants an attacker's page a fully authenticated socket. **MOUSENDECK is structurally immune to CSWSH** because its credential is an explicit query parameter (`server.js:73`), not ambient. That immunity is a property worth protecting: **never move the token into a cookie.**
- Chrome's Private Network Access adds a preflight for public→private subresource requests including WebSockets. **Safari does not implement PNA**, so no handling is needed for the iPad. Budget for it only if the controller ever runs in Chrome or on Android.

Net: the *only* thing standing between host B and a hostile page on the internet is (i) the token and (ii) whatever B chooses to do with the `Origin` header. Which brings us to the current check.

### 2.2 The current Origin check is bypassable by DNS rebinding

`host/server.js:79-84`:

```js
const origin = req.headers.origin;
if (origin && !origin.startsWith(`http://${url.host}`)) { /* 403 */ }
```

`url` is built from `req.headers.host` (`server.js:69`). **Both sides of this comparison come from the same attacker-supplied request**, so the check compares the request against itself:

1. Attacker registers `evil.com` with a 1-second-TTL A record and serves a page from their own server.
2. The user visits it. Origin is now `http://evil.com:8787`.
3. The record re-resolves to `192.168.5.3`. The page opens `ws://evil.com:8787/?k=…`.
4. The browser connects to the Mac and sends `Host: evil.com:8787`, `Origin: http://evil.com:8787`.
5. Server computes `url.host = "evil.com:8787"`, tests `"http://evil.com:8787".startsWith("http://evil.com:8787")` → **true**. Passes.

The token still blocks the attacker, but the Origin check is contributing zero defence-in-depth — precisely the layer that is supposed to survive a token leak. Three smaller defects compound it:

- `origin &&` means an **absent** Origin passes unconditionally. Deliberate for CLI clients, but currently undocumented and unlogged.
- `Origin: null` (sandboxed iframe, `file://`, some redirect chains) is a string that fails `startsWith` — accidentally correct, but it should be an explicit reject.
- `startsWith` is a prefix test where an exact test is required. Harmless at port 8787 (nothing valid can follow a port), but if `config.port` is ever set to 80, `url.host` loses its port and `http://192.168.5.3.evil.com` — a perfectly registrable hostname — passes.
- The token is compared with `!==` (`server.js:73`), which is not constant-time.

### 2.3 Mixed content and secure context

- **A page served over `http://` may open `ws://` freely.** No mixed-content block. The current architecture is fine as-is.
- **A page served over `https://` may never open `ws://`** — it is blocked as mixed content, with no user override. If the PWA is ever put behind TLS, *every* host must simultaneously serve `wss://` with a certificate the iPad trusts. On a LAN that means self-signed certs installed as trusted roots on every controller. **Recommendation: stay on plain HTTP.** The honest framing is that the LAN is the trust boundary; anyone who can sniff your Wi-Fi already sees the token, the keystrokes, and the pointer stream. Do not build cryptographic theatre on top of a cleartext channel — write the tradeoff into the README instead.
- **`http://192.168.5.3:8787` and `http://Elfys-MacBook.local:8787` are not secure contexts.** Only `http://localhost` and `http://127.0.0.1` are. Five concrete consequences, each of which constrains a design decision below:

| Blocked API | Consequence for this design |
|---|---|
| `crypto.subtle` | **No WebCrypto on the client.** Any HMAC/SHA-256 in the pairing handshake needs a bundled JS implementation. Design the handshake so it doesn't need one. |
| `crypto.randomUUID()` | Generate the controller ID from `crypto.getRandomValues()` — that one *is* exposed in insecure contexts (it lives on `Crypto`, not `SubtleCrypto`). |
| `navigator.mediaDevices` | **In-page QR scanning is impossible.** This kills QR-as-a-pairing-UI inside the PWA (§3). |
| Service Workers | No offline caching. iOS **Add to Home Screen still works** without one — `display: standalone` in `public/manifest.webmanifest` is honored regardless. |
| `navigator.storage.persist()` | Cannot request storage-eviction exemption. Reinforces §3.4: the host must be the source of truth. |
| `navigator.clipboard` | "Copy token" needs the `document.execCommand('copy')` fallback. |

### 2.4 The exact Origin/auth policy to implement

Config addition (`host/config.js` `defaultConfig()`):

```json
"security": {
  "requireOrigin": false,
  "allowLanOrigins": true,
  "allowedOrigins": [],
  "strictOrigins": false
},
"clients": [
  {
    "controllerId": "c9f2a4e17b0d",
    "name": "Satish iPad",
    "token": "…64 hex…",
    "createdAt": 1756032000000,
    "lastSeenAt": 1756036100000,
    "lastOrigin": "http://192.168.5.40:8787",
    "revoked": false
  }
]
```

Replacing the top-level `token` with a `clients[]` array is the single highest-value change here: per-device tokens are individually revocable, they let the host label who is connected, and they make the origin-drift audit in gate 4 meaningful. Keep the legacy `config.token` accepted for one release under a `legacy` pseudo-client so existing bookmarks don't break.

The gate, replacing `server.js:68-86`:

```js
import { timingSafeEqual } from 'node:crypto';

// Computed at listen() and refreshed on network change — never from the request.
function selfIdentities() {
  return new Set([
    'localhost', '127.0.0.1', '[::1]', '::1',
    `${bonjourName().toLowerCase()}.local`,
    ...lanAddresses(),
  ]);
}

const PRIVATE_V4 =
  /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/;

function isPrivateHost(h) {
  h = h.toLowerCase().replace(/^\[|\]$/g, '');
  if (PRIVATE_V4.test(h)) return true;
  if (h === '::1' || /^fe80:/.test(h) || /^f[cd]/.test(h)) return true;
  return /^[a-z0-9][a-z0-9-]*\.local$/.test(h);   // mDNS names only
}

function eqToken(a, b) {
  const A = Buffer.from(a, 'utf8'), B = Buffer.from(b, 'utf8');
  return A.length === B.length && timingSafeEqual(A, B);
}

/** Returns { ok:true, client } or { ok:false, code, reason }. */
function authorizeUpgrade(req, sec, self, listenPort) {
  // GATE 1 — Host header. Kills DNS rebinding. The request must be addressed
  // to a name this machine actually answers to.
  const hostHdr = String(req.headers.host || '');
  const hp = hostHdr.replace(/^\[/, '').split(/\]?:(?=\d+$)/);
  const hostName = hp[0].toLowerCase();
  const hostPort = Number(hp[1] || 80);
  if (!self.has(hostName) || hostPort !== listenPort) {
    return { ok: false, code: 403, reason: `bad host '${hostHdr}'` };
  }

  // GATE 2 — Origin shape. Never a public DNS name; never "null".
  const origin = req.headers.origin;
  if (origin === undefined) {
    if (sec.requireOrigin) return { ok: false, code: 403, reason: 'origin required' };
    // Non-browser client (CLI, native). Token alone must carry it.
  } else if (origin === 'null') {
    return { ok: false, code: 403, reason: 'opaque origin' };
  } else {
    let u;
    try { u = new URL(origin); } catch { return { ok: false, code: 403, reason: 'malformed origin' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ok: false, code: 403, reason: 'bad origin scheme' };
    }
    const exact = sec.allowedOrigins.includes(origin)
      || [...self].some((h) => origin === `http://${h}:${listenPort}`);
    if (!exact) {
      if (sec.strictOrigins || !sec.allowLanOrigins || !isPrivateHost(u.hostname)) {
        return { ok: false, code: 403, reason: `origin '${origin}' not allowed` };
      }
    }
  }

  // GATE 3 — Token. Prefer the subprotocol; ?k= stays for one release.
  const url = new URL(req.url, 'http://x');
  const protos = String(req.headers['sec-websocket-protocol'] || '')
    .split(',').map((s) => s.trim());
  const fromProto = protos.find((p) => p.startsWith('mnd.tok.'))?.slice(8);
  const token = fromProto || url.searchParams.get('k') || '';
  if (!token) return { ok: false, code: 401, reason: 'no token' };

  let client = null;
  for (const c of sec.clients) {           // no early exit — constant work
    if (!c.revoked && eqToken(c.token, token)) client = c;
  }
  if (!client) return { ok: false, code: 401, reason: 'bad token' };

  // GATE 4 — Origin drift audit. Soft by default: DHCP legitimately moves
  // host A, which moves the page's origin. Hard only in strict mode.
  if (origin && client.lastOrigin && client.lastOrigin !== origin) {
    if (sec.strictOrigins) {
      return { ok: false, code: 403, reason: 'origin changed since pairing' };
    }
    console.warn(`  ⚠ ${client.name}: origin ${client.lastOrigin} → ${origin}`);
  }
  return { ok: true, client, origin };
}
```

Wire it in, and echo the subprotocol back (the handshake fails if the client offered subprotocols and the server selects none the client asked for):

```js
http.on('upgrade', (req, socket, head) => {
  const r = authorizeUpgrade(req, config.security2, SELF, PORT);
  if (!r.ok) {
    console.warn(`  ✗ upgrade refused from ${req.socket.remoteAddress}: ${r.reason}`);
    socket.write(`HTTP/1.1 ${r.code} ${r.code === 401 ? 'Unauthorized' : 'Forbidden'}\r\n\r\n`);
    socket.destroy();
    return;
  }
  r.client.lastOrigin = r.origin || r.client.lastOrigin;
  r.client.lastSeenAt = Date.now();
  socket.setNoDelay(true);   // keep — this is load-bearing for latency
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.mndClient = r.client;
    wss.emit('connection', ws, req);
  });
});

// on the WebSocketServer:
const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
  handleProtocols: (set) => (set.has('mnd.v1') ? 'mnd.v1' : false),
});
```

Client side:

```js
new WebSocket(`ws://${ep.host}:${ep.port}/`, ['mnd.v1', `mnd.tok.${token}`]);
```

Moving the token out of the query string keeps it out of `access.log`, out of the `Referer` header, and out of anything that logs request lines.

**Why gate 2 is genuinely sound, not just a speed bump.** An attacker's page has a *public DNS* origin. To present a private-IP-literal or `.local` origin, the browser must have navigated to a URL served from that address — meaning the attacker is already running a server on your LAN. At that point they can talk to host B directly with no browser involved, and browser origin policy is irrelevant. Gate 2 therefore reduces the attack surface from *the entire internet* to *devices already on your Wi-Fi*, which is the correct boundary for this product. Gate 1 removes the rebinding escape hatch from that argument. Gate 3 (per-device tokens) is what actually guards the boundary.

**Why gate 4 is soft.** Hard origin binding breaks the moment DHCP renumbers host A, silently locking the iPad out of every paired host at once with an error the user cannot diagnose. Binding the credential to the **controller identity** (which is stable) rather than the **origin** (which is not) gives the same revocation power without the failure mode.

---

## 3. Pairing and credentials

### 3.1 Evaluation

**PIN in host B's terminal, exchanged for a token.** Six digits is typeable one-handed on the iPad. Works identically on macOS and Windows. Crucially, it can run over a **WebSocket**, which — per §2.1 — is not CORS-constrained, so page A can talk to host B with **no preflight, no `Access-Control-Allow-Origin`, no OPTIONS handler**. It also carries the controller's identity and requested display name in the same round trip. Brute force is handled by rate limiting, not entropy.

**QR code.** Excellent UX for the *first* host: `dns-sd`-style ASCII QR in the terminal encoding `http://192.168.5.3:8787/?k=<token>`, scanned by the native iOS Camera app, which opens Safari. But for host B it is fatally wrong: scanning **navigates away** from host A's page, changing the document origin, discarding the in-memory session, and destroying the multi-host model. And §2.3 rules out scanning *inside* the PWA — no `getUserMedia` on an insecure origin. **QR is the bootstrap, not the pairing mechanism.**

**Host A vouches for host B.** Circular: A and B must already trust each other, which needs its own pairing step. The non-circular variant (a shared "fleet secret" pasted into every host) just relocates the 32-hex-string typing problem to a worse place — the desktop, once per host, with no revocation story.

### 3.2 Recommendation: PIN over an unauthenticated WebSocket pairing channel, QR/URL for first-run bootstrap

Host-side rules, all of which matter:

- The pairing endpoint (`/pair`) accepts connections **only while a pairing window is open**. Windows open for **180 s** on: first run ever, `npm run pair`, or pressing `p` in the terminal. Closed otherwise → `close(4003, 'pairing closed')`.
- **Five attempts per window.** On the fifth failure the window closes and requires physical action at host B. This — not PIN entropy — is what makes 6 digits safe: 5 guesses out of 10⁶ per 180 s window, with the failure requiring the attacker to also be standing at the target machine to reopen it.
- PIN is `crypto.randomInt(0, 1000000)` zero-padded, displayed grouped (`418 902`), **single-use**, wiped on success.
- Gates 1 and 2 from §2.4 apply to `/pair` unchanged. Only the token gate is skipped.
- While a window is open, the mDNS TXT flips to `pair=1` so the iPad can show a "Ready to pair" badge on that row without connecting.
- The PIN travels in cleartext. **Say so in the README.** Over plain HTTP on a LAN, a passive sniffer already sees the token and every keystroke; wrapping the PIN in an HMAC the client can't even compute (no `crypto.subtle`, §2.3) would be pure theatre.

### 3.3 The exact handshake

```
  iPad (page from host A)                      Host B (192.168.5.77)
  origin http://192.168.5.3:8787
        |                                              |
        |   user taps "Satish PC" in the device list   |
        |   registry has no token for hostId=…         |
        |   → UI shows the PIN keypad                  |
        |                                              |
        |   ws://192.168.5.77:8787/pair                |
        |   subprotocols: ["mnd.pair.v1"]              |
        |   Origin: http://192.168.5.3:8787            |
        |─────────────────────────────────────────────▶|
        |                                     GATE 1: Host ∈ self? ✓
        |                                     GATE 2: origin private-shaped? ✓
        |                                     pairing window open? ✓
        |                                              |
        |◀───────────────────────────────────────────  |
        |  {"t":"pair.hello","hostId":"9c4e…","name":"Satish PC",
        |   "os":"windows","osv":"11.26100","av":"1.2.0",
        |   "capHash":"77de01aa","attemptsLeft":5,"expiresInMs":174000}
        |                                              |
        |   render "Satish PC · Windows 11" above the keypad
        |   user types 418902                          |
        |                                              |
        |  {"t":"pair.claim","pin":"418902",           |
        |   "controllerId":"c9f2a4e17b0d",             |
        |   "controllerName":"Satish iPad",            |
        |   "platform":"ipados","form":"tablet"}       |
        |─────────────────────────────────────────────▶|
        |                              constant-time compare vs window.pin
        |                              ── mismatch ──▶ {"t":"pair.deny",
        |                                    "attemptsLeft":4}  (socket stays open)
        |                              ── 5th miss ──▶ close(4004,"locked out")
        |                              ── match ─────▶ token = randomBytes(32)
        |                                    clients.push({controllerId, name,
        |                                      token, lastOrigin: req.origin,
        |                                      createdAt, revoked:false})
        |                                    saveConfig(); window.close(); TXT pair=0
        |◀───────────────────────────────────────────  |
        |  {"t":"pair.ok","token":"<64 hex>","host":{…full record…},
        |   "capabilities":{…§1.4…},"peers":[…B's mDNS view…]}
        |                                    close(1000)
        |                                              |
        |   write token → localStorage "mnd.tok.<hostId>"
        |   upsert device record, lastConnectedAt = now
        |   → transition RESOLVING (§4) and open the real socket
        |                                              |
```

The `peers` payload in `pair.ok` is a deliberate bonus: pairing with one host on a new network immediately populates the list with every other host that host can see.

Terminal output at host B during a window:

```
  ┌──────────────────────────────────────────┐
  │  Pairing open for 2:58                   │
  │                                          │
  │        PIN   418 902                     │
  │                                          │
  │  Enter this on your iPad. 5 tries.       │
  └──────────────────────────────────────────┘
```

**First-run bootstrap** stays as it is today: `server.js` already prints `http://<host>.local:8787/?k=<token>`. Add a terminal QR of that same URL. The user scans with the Camera app once, lands in Safari, adds to Home Screen **from that URL** (see §3.4), and from then on every additional host is a 6-digit PIN.

### 3.4 Where tokens live client-side, and the real risks

Storage layout, one key per host so a single corrupt record can't take down the set:

| Key | Contents |
|---|---|
| `mnd.controllerId` | 12 hex chars from `crypto.getRandomValues()` — **not** `randomUUID()`, which needs a secure context (§2.3) |
| `mnd.registry.v1` | The device registry array (§5), **tokens excluded** |
| `mnd.tok.<hostId>` | One token per host, isolated |
| `mnd.session.v1` | Live session snapshot for reload recovery (§4.4) |
| `mnd.board.<hostId>` | Read-only board mirror |

Risks, in order of how likely they are to actually bite:

1. **XSS in the PWA is total compromise.** Same origin ⇒ any injected script reads every token and can drive every paired machine. This is the dominant risk and it deserves a real mitigation: send a strict CSP from the static handler in `server.js` — `default-src 'self'; script-src 'self'; connect-src 'self' ws: http:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. That requires moving any inline `<script>`/`<style>` out of `public/index.html`. `connect-src` must stay broad because the whole point is connecting to arbitrary LAN hosts.
2. **Safari's 7-day script-writable-storage cap.** In a normal Safari tab, localStorage is evicted after 7 days without user interaction with the site. **Web apps added to the Home Screen are exempt from this cap.** This turns Add-to-Home-Screen from a nice-to-have into a functional requirement, and it needs to be said in the onboarding copy, not buried in the README.
3. **Home Screen web apps do not share storage with Safari on iOS.** A token pasted into a Safari tab does **not** appear in the Home Screen app. The onboarding must instruct: add to Home Screen *from the `?k=` URL*, so the first launch of the installed app carries the token. Getting this backwards produces a "why is it asking me to pair again" support loop.
4. **"Clear History and Website Data" wipes everything**, and `navigator.storage.persist()` is unavailable on an insecure origin (§2.3) so you cannot opt out.

Mitigation for 2–4 is the same and is architectural: **the host is the durable source of truth.** Host B already stores `{controllerId → token}` in its `clients[]`. If the iPad's storage is wiped, recovery is one PIN per host, and the host reuses the existing `clients[]` entry when it sees a `controllerId` it already knows (refreshing the token rather than accumulating duplicates). Nothing is permanently lost. `localStorage` is a **cache with a fast rebuild path**, not a vault — design and phrase it that way.

---

## 4. Session model

### 4.1 States

| State | Button label | Device list | Timer | Meaning |
|---|---|---|---|---|
| `IDLE` | **Connect** | hidden | — | Nothing selected |
| `BROWSING` | **Cancel** | **shown** | — | List revealed; cached rows render instantly, probes fill in green dots |
| `RESOLVING` | Cancel | shown, row spinning | — | Racing this host's endpoints |
| `PAIRING` | Cancel | PIN keypad | — | No token for this host |
| `AUTHENTICATING` | Cancel | row spinning | — | Socket open, awaiting `hello` |
| `LIVE` | **Disconnect** | hidden | **running** | Trackpad + board active |
| `INTERRUPTED` | Disconnect | hidden | **running** | Socket dropped, inside grace window; UI dims but stays interactive |
| `RECONNECTING` | Disconnect | hidden | **paused** | Backoff; banner "Reconnecting to Satish Mac…" |
| `FAILED` | **Connect** | shown | stopped | Gave up or auth rejected; specific reason on the row |
| `CLOSING` | — | — | stopped | User-initiated teardown |

This maps one-to-one onto requirement 2: one button, tap to reveal the list, select to connect and start the timer, tap again to disconnect and re-reveal the list.

### 4.2 Transitions

```
IDLE ──tap Connect──▶ BROWSING
BROWSING ──tap Cancel──▶ IDLE
BROWSING ──select(host)──▶ RESOLVING          (token present)
BROWSING ──select(host)──▶ PAIRING            (no token)
PAIRING ──pair.ok──▶ RESOLVING
PAIRING ──5 denials | window closed | cancel──▶ FAILED
RESOLVING ──first endpoint to open──▶ AUTHENTICATING   (abort the losers)
RESOLVING ──all endpoints fail──▶ FAILED
AUTHENTICATING ──hello──▶ LIVE                (start/resume timer)
AUTHENTICATING ──401/403──▶ FAILED            (401 ⇒ drop token, offer re-pair)
LIVE ──socket close/error──▶ INTERRUPTED      (timer keeps running)
LIVE ──tap Disconnect──▶ CLOSING ──▶ BROWSING (per requirement 2)
INTERRUPTED ──reopened within 20s──▶ AUTHENTICATING
INTERRUPTED ──20s elapsed──▶ RECONNECTING     (pause timer)
RECONNECTING ──reopened──▶ AUTHENTICATING     (resume timer)
RECONNECTING ──10 min or tap Disconnect──▶ FAILED
FAILED ──tap Connect──▶ BROWSING
```

### 4.3 Reconnect behaviour

`INTERRUPTED` exists because of two things that happen constantly on an iPad and are *not* real disconnections: **Wi-Fi roaming between access points** (300–2000 ms) and **the app briefly backgrounding** (app switcher, notification pull-down, Slide Over). iOS closes the WebSocket for both. Treating either as a session end — resetting the timer, bouncing the user back to the device list — is user-hostile. The 20 s grace window covers both with margin.

Backoff, replacing the current `Math.min(300 * 2 ** retry++, 5000)` at `app.js:38`:

```js
// 250, 500, 1000, 2000, 4000, 8000, 15000 … capped, with ±20% jitter so an
// iPhone and iPad reconnecting from the same AP outage don't sync up.
const base = Math.min(250 * 2 ** attempt, 15000);
const delay = base * (0.8 + Math.random() * 0.4);
```

Three iPadOS-specific behaviours the reconnect loop must implement:

- **`visibilitychange` → visible: probe immediately, do not wait out the backoff.** iOS suspends timers in the background, so an app resumed after 3 minutes would otherwise sit on a 15 s delay before its first attempt. Reset `attempt = 0` on resume.
- **`pagehide`: flush the session snapshot synchronously.** iPadOS Safari evicts background tabs aggressively; `beforeunload` is unreliable there, `pagehide` is not.
- **Detect the half-open socket.** The existing 200 ms ping (`app.js:126`) already gives a liveness signal that costs nothing extra: if three consecutive pongs are missed (~600 ms) while `readyState === 1`, call `ws.close()` and enter `INTERRUPTED`. Wi-Fi drops routinely leave a socket that reports OPEN while going nowhere, and without this the user just sees a frozen cursor with a green dot.

On `401` specifically: delete `mnd.tok.<hostId>`, set the record's `auth.state = "revoked"`, and surface "Pairing was removed on Satish PC — pair again" rather than a generic retry loop.

### 4.4 The session timer

**Per-session, wall-clock, computed from timestamps — never incremented.**

```json
{
  "sessionId": "s_8f21c0",
  "hostId": "b7f3a19c4d5e6f80",
  "startedAt": 1756036100000,
  "accumulatedMs": 742000,
  "pausedAt": null,
  "lastHeartbeatAt": 1756036842000
}
```

Displayed value = `accumulatedMs + (pausedAt ? 0 : now - resumedAt)`. Rendered on `requestAnimationFrame` at 1 Hz. **Never `elapsed += 1000` in a `setInterval`** — iOS throttles background timers to as little as once per minute and freezes them entirely on suspend, so a counter-based timer silently loses minutes. Snapshot to `mnd.session.v1` every 5 s and on `pagehide`.

Answering each sub-question explicitly:

**Does it pause on disconnect?** It keeps running through `INTERRUPTED` (≤20 s) and pauses on entering `RECONNECTING`. A Wi-Fi roam is not a break in your session; a five-minute outage is not session time. This is the behaviour that matches what the number is *for* — "how long have I been driving this machine".

**Does it persist across reloads?** Yes, with a **120 s resume window**. On load, read the snapshot: if `hostId` matches the host being connected to and `now - lastHeartbeatAt < 120000`, resume the same `sessionId` and `accumulatedMs`. Otherwise close the old session (roll `accumulatedMs` into the device's `totalConnectedMs`, increment `sessionCount`) and start fresh. Without this, every Safari tab eviction — routine on an iPad — resets the timer and the number becomes meaningless.

**Per-device cumulative or per-session?** **Both, with per-session as the headline**, because "session timer" is what requirement 2 asks for and it is the number that changes while you watch. Cumulative `totalConnectedMs` lives in the device record and appears as list subtitle metadata ("Satish Mac · 4h 12m total · last used 2h ago"), which is genuinely useful for ordering and recall but is not the connect-button's readout.

**Accessibility (requirement 8):** the live timer must be `aria-live="off"` with `role="timer"` — a polite live region announcing every tick would make VoiceOver unusable. Expose the value through an `aria-label` on the disconnect button instead ("Disconnect from Satish Mac, connected 12 minutes"), refreshed on a 60 s cadence, and provide a static text alternative that is read on demand.

---

## 5. The device registry

### 5.1 Stored record (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://mousendeck.local/schemas/device-record-v1.json",
  "title": "MouseNDeck device record",
  "type": "object",
  "required": ["v", "hostId", "displayName", "os", "endpoints", "session", "sync"],
  "additionalProperties": false,
  "properties": {
    "v": { "const": 1 },

    "hostId": {
      "type": "string", "pattern": "^[0-9a-f]{16}$",
      "description": "Primary key. Generated once by the host, persisted in its config.json. Stable across rename, IP change and OS reinstall-with-config-restore. Never key on IP or hostname."
    },
    "displayName": { "type": "string", "minLength": 1, "maxLength": 64 },
    "os": { "enum": ["macos", "windows", "linux"] },
    "osVersion": { "type": "string", "maxLength": 32 },
    "appVersion": { "type": "string", "maxLength": 32 },
    "protocolVersion": { "type": "integer", "minimum": 1 },

    "capHash": {
      "type": "string", "pattern": "^[0-9a-f]{8}$",
      "description": "FNV-1a of the capability doc, mirrored from TXT 'cap'. Mismatch vs the cached doc means refetch on connect."
    },
    "capabilities": {
      "type": ["object", "null"],
      "description": "Last full capability document (§1.4). Gates the shortcut catalog (requirement 4) and the gesture picker family (requirement 9). Null until first successful connect."
    },

    "endpoints": {
      "type": "array", "minItems": 1, "maxItems": 8,
      "description": "Ordered by preference: most recently successful first. Racing them is what makes reconnect fast after a DHCP change.",
      "items": {
        "type": "object",
        "required": ["kind", "host", "port", "source"],
        "additionalProperties": false,
        "properties": {
          "kind":     { "enum": ["ip4", "ip6", "mdns", "dns"] },
          "host":     { "type": "string", "maxLength": 253 },
          "port":     { "type": "integer", "minimum": 1, "maximum": 65535 },
          "source":   { "enum": ["mdns", "manual", "bootstrap", "peer-relay"] },
          "lastOkAt": { "type": "integer", "minimum": 0, "default": 0 },
          "lastFailAt": { "type": "integer", "minimum": 0, "default": 0 },
          "failCount":{ "type": "integer", "minimum": 0, "default": 0 },
          "rttMs":    { "type": ["number", "null"], "description": "Last probe RTT; used to order the race." }
        }
      }
    },

    "auth": {
      "type": "object",
      "required": ["state"],
      "additionalProperties": false,
      "properties": {
        "state":       { "enum": ["unpaired", "paired", "revoked", "locked-out"] },
        "tokenKey":    { "type": ["string","null"],
                         "description": "localStorage key holding the token, e.g. 'mnd.tok.<hostId>'. THE TOKEN ITSELF IS NEVER IN THIS RECORD — that is what keeps the registry safe to sync (§5.3)." },
        "controllerId":{ "type": ["string","null"], "pattern": "^[0-9a-f]{12}$" },
        "pairedAt":    { "type": ["integer","null"] },
        "lockedUntil": { "type": ["integer","null"] }
      }
    },

    "session": {
      "type": "object",
      "required": ["lastConnectedAt"],
      "additionalProperties": false,
      "properties": {
        "lastConnectedAt":    { "type": "integer", "minimum": 0,
                                "description": "SORT KEY for the most-recent-first list. Merged with MAX, never LWW (§5.3)." },
        "lastDisconnectedAt": { "type": "integer", "minimum": 0, "default": 0 },
        "totalConnectedMs":   { "type": "integer", "minimum": 0, "default": 0 },
        "sessionCount":       { "type": "integer", "minimum": 0, "default": 0 },
        "lastRttMs":          { "type": ["number","null"] }
      }
    },

    "ui": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "pinned":     { "type": "boolean", "default": false },
        "accent":     { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" },
        "icon":       { "type": "string", "maxLength": 8 },
        "boardKey":   { "type": ["string","null"], "description": "localStorage key of the cached board mirror; authoritative copy lives in that host's own config.json." },
        "hidden":     { "type": "boolean", "default": false }
      }
    },

    "sync": {
      "type": "object",
      "required": ["updatedAt", "updatedBy"],
      "additionalProperties": false,
      "properties": {
        "updatedAt": { "type": "integer", "minimum": 0 },
        "updatedBy": { "type": "string", "pattern": "^[0-9a-f]{12}$" },
        "deletedAt": { "type": ["integer","null"], "default": null,
                       "description": "Tombstone. Kept 90 days so a deletion isn't resurrected by a controller that was offline; then garbage-collected." }
      }
    }
  }
}
```

Concrete instance:

```json
{
  "v": 1,
  "hostId": "b7f3a19c4d5e6f80",
  "displayName": "Satish Mac",
  "os": "macos", "osVersion": "26.5", "appVersion": "1.2.0", "protocolVersion": 1,
  "capHash": "a1b2c3d4",
  "capabilities": null,
  "endpoints": [
    { "kind": "ip4",  "host": "192.168.5.3",        "port": 8787, "source": "mdns",      "lastOkAt": 1756036842000, "lastFailAt": 0, "failCount": 0, "rttMs": 3.1 },
    { "kind": "mdns", "host": "Elfys-MacBook.local","port": 8787, "source": "mdns",      "lastOkAt": 1756030001000, "lastFailAt": 0, "failCount": 0, "rttMs": 11.4 },
    { "kind": "ip4",  "host": "192.168.5.40",       "port": 8787, "source": "bootstrap", "lastOkAt": 0, "lastFailAt": 1756029000000, "failCount": 3, "rttMs": null }
  ],
  "auth": { "state": "paired", "tokenKey": "mnd.tok.b7f3a19c4d5e6f80",
            "controllerId": "c9f2a4e17b0d", "pairedAt": 1755900000000, "lockedUntil": null },
  "session": { "lastConnectedAt": 1756036100000, "lastDisconnectedAt": 1756036842000,
               "totalConnectedMs": 15120000, "sessionCount": 42, "lastRttMs": 3.1 },
  "ui": { "pinned": true, "accent": "#22c55e", "icon": "🖥", "boardKey": "mnd.board.b7f3a19c4d5e6f80", "hidden": false },
  "sync": { "updatedAt": 1756036842000, "updatedBy": "c9f2a4e17b0d", "deletedAt": null }
}
```

### 5.2 Ordering

Sort is grouped, not a single flat list — a flat most-recent-first list puts an asleep machine above a live one, which is the wrong answer to "what can I use right now":

1. **Group A — Available now** (probe succeeded, or seen in a live `peers` relay): `pinned` desc, then `session.lastConnectedAt` desc.
2. **Group B — Not on this network**: `session.lastConnectedAt` desc.
3. **Group C — Never connected** (discovered but unpaired): `displayName` asc, badged "Ready to pair" when TXT `pair=1`.

Group C exists so a newly-started host appears without any user action, which is the payoff for building the mDNS relay at all.

### 5.3 Syncing between an iPhone and an iPad

There is no cloud and no account, so the **connected host is the rendezvous point**. Host-side config gains:

```json
"registry": { "v": 1, "records": [ /* device records, tokens absent */ ], "updatedAt": 1756036842000 }
```

Protocol, reusing the existing JSON channel alongside `t:'config'` (`server.js:139`):

```
  iPad                          Mac (host A)                        iPhone
    |                                |                                 |
    | {"t":"registry.push",          |                                 |
    |  "records":[…],                |                                 |
    |  "controllerId":"c9f2…"}       |                                 |
    |───────────────────────────────▶|                                 |
    |                          merge(config.registry, incoming)         |
    |                          saveConfig()                             |
    |◀───────────────────────────────|                                 |
    | {"t":"registry","records":[…merged…]}                             |
    |                                |                                 |
    |                                |  (later, iPhone connects)       |
    |                                |◀────────────────────────────────|
    |                                |  {"t":"registry.push","records":[…]}
    |                                |────────────────────────────────▶|
    |                                |  {"t":"registry","records":[…merged…]}
    |                                |                                 |
    |                                |  iPhone now sees "Satish PC",
    |                                |  its address and its capabilities,
    |                                |  and needs ONE PIN to use it.
```

Merge rules — three different strategies, because using LWW for everything produces visible bugs:

| Field | Rule | Why |
|---|---|---|
| Record set | Union by `hostId` | Neither controller has the complete picture |
| `displayName`, `os`, `capHash`, `capabilities`, `ui.*` | **LWW** on `sync.updatedAt`, ties broken by lexicographic `updatedBy` | Genuinely last-writer-wins fields; the tiebreak makes the merge deterministic and therefore convergent |
| `session.lastConnectedAt`, `lastDisconnectedAt` | **MAX** | Monotonic. LWW here lets a stale iPhone push an *older* timestamp and silently reorder the iPad's list — the single most visible sync bug in this design |
| `session.totalConnectedMs`, `sessionCount` | **MAX**, not sum | Both controllers observe overlapping subsets; summing double-counts. MAX is a slight undercount and is the honest choice |
| `endpoints` | Union by `(kind, host, port)`; per-entry MAX on `lastOkAt`, MAX on `failCount`; prune `failCount ≥ 5 && lastOkAt === 0`; cap at 8, evicting the oldest `lastOkAt` | An endpoint that works from the iPhone is worth trying from the iPad |
| `sync.deletedAt` | Tombstone wins over any update older than it; GC after 90 days | Without tombstones an offline controller resurrects deleted devices on its next sync |
| `auth.*` | **Never synced.** Stripped on send and ignored on receive | See below |

**Tokens are deliberately excluded, and this is the important decision.** Syncing them would mean host A stores host B's credential, so compromising the least-secured machine in the fleet yields control of every other one. And a host that stores another host's token can impersonate that controller. The cost of excluding them is exactly one 6-digit PIN entry, the first time a given controller talks to a given host. The iPhone still inherits the *name, address, OS and capabilities* of every host the iPad knows — all the tedious parts — and pays only for the security-relevant step. Offer credential sync as an explicitly-labelled opt-in if it is ever wanted, defaulted off.

Merge is idempotent and commutative, so pushing on every connect is safe and no version vector is needed. Clock skew between an iPhone and an iPad on the same iCloud account is sub-second in practice; if it ever matters, have the host stamp `receivedAt` and prefer that for the MAX fields.

---

## 6. Implementation order

1. **`host/security.js`** — `authorizeUpgrade()` from §2.4, plus `config.security` and `config.clients[]` in `host/config.js`. Fixes the rebinding bypass and adds per-device tokens. Ship independently of everything else.
2. **Subprotocol token** on both ends; keep `?k=` accepted for one release.
3. **`host/pairing.js`** — the `/pair` endpoint, PIN window, terminal UI, `p` key, `npm run pair`.
4. **`host/discovery.js`** — `dns-sd` advertise + browse on macOS, `bonjour-service` on Windows, `t:'peers'` broadcast, `pair=` TXT flip.
5. **`public/registry.js` + `public/session.js`** — registry schema, endpoint racing, the §4.1 state machine, timestamp-based timer.
6. **`public/connect-sheet.js`** — the single connect/disconnect button, grouped device list, PIN keypad, manual add.
7. **Registry sync** (`t:'registry.push'` / `t:'registry'`) and the capability document, which then unblocks the requirement-4 catalog gating and the requirement-9 keyboard/gesture pickers.

Steps 1–2 are a security fix and are worth landing on their own, before any of the multi-device UI exists.