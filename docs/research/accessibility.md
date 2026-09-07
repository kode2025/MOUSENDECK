# MOUSENDECK — Accessibility Specification

Two unrelated things share the word "accessibility" in this project. They are separated below and never mixed.

- **Part A — macOS Accessibility *permission* (TCC).** A privacy authorization that lets `mdinput` post CGEvents.
- **Part B — UI accessibility** of the iPad PWA (WCAG 2.2 AA + Apple HIG).

Verified on the actual machine: macOS 26.5 (build 25F71), arm64.

---

# PART A — macOS Accessibility Permission (TCC)

## A.0 Ground truth measured on this machine

```
$ file $(which npm)
/opt/homebrew/bin/npm: a /usr/bin/env node script text executable, ASCII text
$ head -2 $(which npm)
#!/usr/bin/env node
require('../lib/cli.js')(process)

$ codesign -dv --verbose=4 $(which node)
Executable=/usr/local/bin/node
Authority=Developer ID Application: Node.js Foundation (HX7739G8FX)

$ codesign -dv --verbose=4 host/native/mdinput
Format=Mach-O thin (arm64)
CodeDirectory ... flags=0x20002(adhoc,linker-signed)
CDHash=10f857baa3408da9419fd9da85605930770e9e31
Signature=adhoc
Info.plist=not bound
```

Three facts follow directly and drive everything in Part A:

1. **`npm` is a text script, not a Mach-O binary.** No process named `npm` ever exists. `npm` is `exec`'d by `node`.
2. **`node` is Developer ID–signed** and therefore *is* a valid TCC subject — which is precisely why granting it is dangerous.
3. **`mdinput` is ad-hoc, linker-signed, with no bound `Info.plist`.** Its identity is a bare CDHash that changes on every `swiftc` run.

## A.1 The responsible process

TCC does not ask "which process called `CGEventPost`". It walks a chain to find the **responsible code** and records the decision against *that*.

Apple DTS (Quinn) states the rule directly:

> "TCC has the concept of finding the *responsible code*. … The exact algorithm it uses for this is not documented, has changed in the past, and may well change in the future."

and enumerates the cases:

> - Run by the user from Terminal, or over SSH — **"The tool's responsible code is Terminal."**
> - Spawned as a child process (a *helper tool*) by an app — "The system treats the app as the responsible code."
> - Run by `launchd` as a daemon or agent — "If the daemon or agent was installed by `SMAppService`, that makes the app the responsible code. Otherwise, the daemon or agent should include `AssociatedBundleIdentifiers` in its `launchd` property list."

> "It's not about how the tool is compiled, it's about how it's run."
> — [On File System Permissions / How to grant command line tools full disk access, Apple Developer Forums](https://developer.apple.com/forums/thread/756510)

The design goal, in Quinn's words:

> "if an app contains a helper tool and the helper tool triggers a MAC prompt, we want: the app's name and usage description to appear in the alert; the user's decision to be recorded for the whole app, not that specific helper tool; that decision to show up in System Settings under the app's name."
> — [Apple Developer Forums thread 678819](https://developer.apple.com/forums/thread/678819)

### Applied to MOUSENDECK's current chain

```
Terminal.app  →  zsh  →  npm (script; exec'd by node)  →  node  →  mdinput
    ▲                                                                 │
    └───────────────── responsible process ◄──────────────────────────┘
```

`mdinput` calls `CGEventPost`. TCC walks up, finds the terminal emulator at the root of the session, and attributes the grant to **Terminal.app** (or iTerm2, Ghostty, WezTerm, or VS Code's integrated terminal — whichever emulator actually launched the shell). The Qt engineering write-up demonstrates this empirically with `launchctl`, showing `responsible path = /Applications/iTerm.app/Contents/MacOS/iTerm2` for a process launched from iTerm ([The Curious Case of the Responsible Process](https://www.qt.io/blog/the-curious-case-of-the-responsible-process)).

**Verify it yourself on this machine:**

```bash
launchctl procinfo $(pgrep -x mdinput) | grep -i -A1 responsible
```

Expect the terminal emulator's path, *not* `.../host/native/mdinput`.

**Watch TCC decide, live:**

```bash
log stream --style compact --predicate \
  'subsystem == "com.apple.TCC" AND eventMessage CONTAINS "Accessibility"'
```

### REQ-A1 (documentation requirement)

`/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/README.md` must state that the Accessibility grant is held by **the terminal application you start the server from**, name the specific emulator detected at runtime, and warn that starting the server from a *different* emulator requires granting that one separately.

The host can detect this and say so. `host/input.js` already has `checkAccessibility()`; extend it:

```js
// host/input.js — report WHO holds the grant, not just whether we have it.
import { execFileSync } from 'node:child_process';

export function responsibleProcess() {
  try {
    const out = execFileSync('/bin/launchctl', ['procinfo', String(process.pid)],
                             { encoding: 'utf8' });
    return out.match(/responsible path\s*=\s*(.+)/)?.[1]?.trim() ?? null;
  } catch { return null; }
}
```

Surface that string in the PWA's setup screen: *"Accessibility is granted to **Terminal**, not to MouseNDeck."*

## A.2 Why adding `npm` to the Accessibility list does not work

**It cannot work, for three independent reasons.**

1. **`npm` is not code.** It is an ASCII file beginning `#!/usr/bin/env node` (verified above). TCC subjects are Mach-O images with a code signature. The System Settings file picker will either refuse it or create a row that can never match any running process, because *no process is ever `npm`* — the kernel execs `node` with `npm/lib/cli.js` as an argument.

2. **Even if it were a binary, it is the wrong process.** `npm` (were it a process) exits or becomes `node`. The process calling `CGEventPost` is `mdinput`, a separate `posix_spawn`'d child. TCC decisions are not transferred between sibling processes; they are resolved through the *responsible* chain, which terminates at Terminal.

3. **Homebrew rewrites the path.** `/opt/homebrew/bin/npm` is a symlink into a versioned Cellar directory. A `brew upgrade node` moves the target and orphans the row.

### What to add instead — three options, best last

| Option | What you add | Scope of grant | Survives rebuild? | Verdict |
|---|---|---|---|---|
| **1. Terminal.app** | `/System/Applications/Utilities/Terminal.app` | Everything you ever type into any Terminal window, forever | Yes | **Works today. Far too broad.** |
| **2. `node`** | `/usr/local/bin/node` | Every Node script on the machine, from any launcher | Yes (Developer ID signed) | **Do not.** Worse than option 1 — it is invisible; a `npx` one-liner from any project inherits it. |
| **3. A signed `.app` bundle wrapping `mdinput`** | `MouseNDeckInput.app` | Only this injector | Yes, *if properly signed* (§A.5) | **Recommended. Specified in §A.4.** |

On option 2, the community guidance is exact and worth quoting to the user:

> "Treat a `node` entry in System Settings as broad permission for that Node runtime, not as permission for one npm package."
> — [OpenClaw macOS permissions](https://docs.openclaw.ai/platforms/mac/permissions)

### REQ-A2

The setup flow must never instruct the user to add `npm` or `node`. If `checkAccessibility()` returns `untrusted`, the guidance shown must be Option 1 (quick start) or Option 3 (recommended), with the trade-off stated in one sentence each.

Deep-link to the correct pane:

```
x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility
```

or from Swift, `AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true])`, which shows the system alert with a **Open System Settings** button.

> **Note:** unlike Camera or Microphone, `kTCCServiceAccessibility` has **no `Info.plist` usage-description key** and no custom purpose string. You cannot explain yourself in the alert; the text is system-supplied. Your explanation must live in your own UI, shown *before* you trigger the prompt.

## A.3 Why a full Cmd+Q and relaunch is required

Three separate caching layers stack up. All three are cleared only by terminating the responsible process.

1. **The trusted bit is latched per process.** A process's Accessibility trust is resolved when it establishes its TCC session, and existing processes are not re-evaluated when the user flips the toggle. The behavior is corroborated across Apple's own forums — e.g. a report that `AXIsProcessTrustedWithOptions` "returns false as expected **only after the process is killed and relaunched by launchd**" ([thread 99868](https://developer.apple.com/forums/thread/99868), [thread 727984](https://developer.apple.com/forums/thread/727984)). Apple does not document the caching, so treat "relaunch" as the only supported remedy, not an optimization.

2. **Closing a window ≠ quitting the app.** `⌘W` closes a Terminal window; `Terminal.app` keeps running. The *responsible process instance* is unchanged, so a new tab inherits the same stale evaluation. Only `⌘Q` terminates it.

3. **Your own descendants survive.** `bin/mousendeck` `exec`s `node`, which spawns `mdinput` and **auto-restarts it with backoff** (`host/input.js`). A restarted `mdinput` is a new process, but it is still parented under the *same* stale Terminal instance, so it inherits the same stale answer.

### REQ-A3 — the exact recovery procedure the README must give

```
1. System Settings ▸ Privacy & Security ▸ Accessibility ▸ enable "Terminal"
2. Ctrl-C the MouseNDeck server
3. ⌘Q Terminal   ← QUIT, not close-window. This is the step everyone skips.
4. Reopen Terminal, run:  ./bin/mousendeck
```

### REQ-A4 — detect the stale state and say so

`host/input.js` currently spawns `mdinput` before anything checks trust. Add a preflight:

```js
const trust = checkAccessibility();
if (trust !== 'trusted') {
  const who = responsibleProcess() ?? 'your terminal';
  console.error(
`\n  Accessibility permission is not active for this session.\n` +
`  Grant it to:  ${who}\n` +
`  Then FULLY QUIT that app (Cmd-Q) and start MouseNDeck again.\n` +
`  Closing the window is not enough.\n`);
}
```

Also expose `trust` over the WebSocket config message so the PWA can show a blocking setup card instead of silently doing nothing when the user drags a finger.

## A.4 Narrowing the grant: package `mdinput` as its own `.app`

**The mechanism.** `open` hands the launch to LaunchServices, so the new process is parented under `launchd`, not under your shell — which severs the responsibility chain to the terminal and makes the bundle its own responsible code. The Qt write-up notes `open` "parents it under launchd" rather than the terminal, and that this "only works for application bundles, not standalone executables" ([qt.io](https://www.qt.io/blog/the-curious-case-of-the-responsible-process)).

Result: **System Settings ▸ Accessibility shows "MouseNDeck Input"**, and Terminal needs no grant at all.

> The lower-level alternative is `responsibility_spawnattrs_setdisclaim()` — an undocumented `posix_spawn` attribute that lets a child "break free from its parent process and become responsible for its own permissions" ([qt.io](https://www.qt.io/blog/the-curious-case-of-the-responsible-process), [ghostty#9263](https://github.com/ghostty-org/ghostty/issues/9263)). **Do not use it here.** It is undocumented SPI, it is unavailable from Node without a native addon, and the Ghostty maintainers closed their proposal on exactly the security grounds that apply to us — pushing TCC grants toward more general-purpose processes widens the attack surface. The `.app` + LaunchServices route is documented behavior and gives a *narrower* grant.

### A.4.1 Bundle layout

```
/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/host/native/
└── MouseNDeckInput.app/
    └── Contents/
        ├── Info.plist
        ├── MacOS/
        │   └── MouseNDeckInput      ← the compiled mdinput binary
        └── Resources/
            └── AppIcon.icns          (optional; nice in the TCC list)
```

### A.4.2 `Info.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>            <string>dev.mousendeck.input</string>
  <key>CFBundleName</key>                  <string>MouseNDeck Input</string>
  <key>CFBundleDisplayName</key>           <string>MouseNDeck Input</string>
  <key>CFBundleExecutable</key>            <string>MouseNDeckInput</string>
  <key>CFBundlePackageType</key>           <string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key> <string>6.0</string>
  <key>CFBundleShortVersionString</key>    <string>1.0.0</string>
  <key>CFBundleVersion</key>               <string>1</string>
  <key>CFBundleIconFile</key>              <string>AppIcon</string>

  <!-- Agent: no Dock tile, no menu bar. Still a full LaunchServices app. -->
  <key>LSUIElement</key>                   <true/>
  <key>LSMinimumSystemVersion</key>        <string>13.0</string>
  <key>NSHighResolutionCapable</key>       <true/>
  <key>NSSupportsAutomaticTermination</key><false/>
  <key>NSSupportsSuddenTermination</key>   <false/>
</dict>
</plist>
```

Notes:
- **`CFBundleIdentifier` is the TCC primary key.** Changing it creates a brand-new permission identity and silently loses the grant. Freeze `dev.mousendeck.input` forever.
- **No `NSPrincipalClass` is required** — the executable is a plain tool. But it *must* keep a run loop alive (below), or LaunchServices sees an app that launched and vanished.
- **`LSUIElement` = true** keeps it out of the Dock and ⌘-Tab. It still appears in the Accessibility list.
- **There is no `NSAccessibilityUsageDescription` key.** Do not invent one.

### A.4.3 Swift changes required in `mdinput.swift`

`/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/host/native/mdinput.swift` currently reads stdin. Under `open`, **stdin is `/dev/null`** — there is no pipe. Replace it with a Unix domain socket and add an activation policy + run loop:

```swift
import AppKit
// Never take focus, never appear in the Dock, even though we are a bundled app.
NSApplication.shared.setActivationPolicy(.prohibited)
```

The process must not exit when the socket closes without a run loop; keep `RunLoop.current.run()` (or `dispatchMain()`) as the tail of `main`, and let the socket read source drive event injection.

### A.4.4 IPC: replace the stdin pipe with a Unix domain socket

**Socket path.** Use the per-user, mode-`0700` Darwin temp directory — not `/tmp` (world-writable) and not `~/Library/Application Support` (survives reboot; leaves stale sockets):

```bash
$(getconf DARWIN_USER_TEMP_DIR)mousendeck.sock
```

**Who listens.** **Node listens; `mdinput` connects.** This keeps the supervisor/restart/backoff logic in `host/input.js` where it already lives, and it means a crashed injector reconnects rather than requiring Node to re-`open` it.

**Node side** (`host/input.js` rewrite sketch):

```js
import net from 'node:net';
import { execFile } from 'node:child_process';
import { unlinkSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DIR  = execFileSync('getconf', ['DARWIN_USER_TEMP_DIR'], {encoding:'utf8'}).trim();
const SOCK = DIR + 'mousendeck.sock';
const APP  = join(ROOT, 'host', 'native', 'MouseNDeckInput.app');

let peer = null;
try { unlinkSync(SOCK); } catch {}

const srv = net.createServer((sock) => {
  sock.setNoDelay(true);           // no-op on AF_UNIX, harmless and explicit
  peer = sock;
  sock.on('close', () => { peer = null; scheduleRelaunch(); });
});
srv.listen(SOCK, () => {
  chmodSync(SOCK, 0o600);          // filesystem perms ARE the auth boundary
  launch();
});

function launch() {
  //  -g  do not bring to foreground   -n  force a fresh instance
  execFile('/usr/bin/open', ['-g', '-n', '-a', APP, '--args', '--sock', SOCK]);
}

export function send(cmd) {
  if (!peer?.writable) return false;
  peer.write(`${JSON.stringify(cmd)}\n`);
  return true;
}
```

**Framing.** Keep the existing wire format exactly. The pointer hot-path opcodes are already fixed-length, so a stream socket needs *no* length prefix — a 1-byte opcode plus a static length table is sufficient and adds zero bytes:

| op | meaning | total bytes |
|---|---|---|
| 1 | move (int16 dx, int16 dy) | 5 |
| 2 | scroll (int16 dx, int16 dy) | 5 |
| 3 | button down (uint8) | 2 |
| 4 | button up (uint8) | 2 |
| 5 | click (uint8 btn, uint8 n) | 3 |
| 6 | ping (uint32) | 5 |

Control-plane messages (key, text, media, run-action) stay newline-delimited JSON on the same socket, distinguished by a reserved opcode `0x7B` (`{`).

**Latency impact — this matters given the project's stated priority.** `AF_UNIX` `SOCK_STREAM` on macOS is a kernel-buffer copy with no Nagle and no protocol stack; a round trip measures in the tens of microseconds, statistically indistinguishable from the current `pipe(2)`. Do not accept this change without measuring it: add a bench that timestamps at `ws.onmessage` in Node and at `CGEventPost` in Swift, and record p50/p99 before and after in the README. Budget: **regression must be < 0.2 ms p99**, or revert.

**Handshake / anti-spoofing.** Filesystem mode `0600` plus a per-user temp dir is the real boundary. Add a cheap defense against a stale or foreign client: Node writes a 32-byte random nonce at listen time to `$DIR/mousendeck.key` (mode `0600`) and `mdinput` must send it as the first frame; on mismatch Node destroys the socket.

### A.4.5 `launch` / teardown details

- `open` returns immediately and does **not** report the child PID. Have `mdinput` send `{"t":"hello","pid":<getpid()>}` as its first JSON frame; Node stores it so it can `kill` on shutdown.
- On Node exit, send `{"t":"bye"}` and `unlink` the socket; `mdinput` exits its run loop when the socket closes **and** it has seen `bye`. Without `bye`, it retries connecting for 30 s (covers a Node restart), then exits so it never lingers with a live Accessibility grant.
- Register the bundle once so `open -a` by name also works: `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f host/native/MouseNDeckInput.app`. Using the full path with `-a` works without this.

## A.5 Code signing — the part that decides whether the grant survives

Quinn is explicit about why ad-hoc is not enough:

> "If your code is unsigned, or signed ad hoc (Signed to Run Locally in Xcode parlance), the system can't tell that version N+1 of your code is the same as version N, and thus you'll encounter excessive prompts."
> — [Apple Developer Forums thread 678819](https://developer.apple.com/forums/thread/678819)

Mechanically: an ad-hoc signature has no Team ID, so TCC's stored `csreq` pins the **CDHash**. Our current binary's CDHash is `10f857baa3408da9419fd9da85605930770e9e31` — a fresh `swiftc` run produces a different one, and the grant evaporates. This is well documented: "For ad-hoc signed apps … the Designated Requirement is based on the exact cdhash — which changes on every rebuild" ([evoleinik.com](https://evoleinik.com/posts/macos-dev-signing-preserve-permissions/), [OpenClaw](https://docs.openclaw.ai/platforms/mac/permissions)).

### Tier 1 — ad-hoc (minimum viable; **not** recommended as the default)

```bash
codesign --force --sign - \
         --identifier dev.mousendeck.input \
         --timestamp=none \
         host/native/MouseNDeckInput.app
```

Launchable, TCC-listable, **and the user must re-grant Accessibility after every `npm run build`.** Only acceptable if the user never rebuilds.

### Tier 2 — self-signed certificate with a stable identity (**recommended**)

This project has no paid Apple Developer account, so a Developer ID cert is out. A **self-signed code-signing certificate** gives the stable identity TCC needs, at zero cost. Create it once:

```bash
# 1. Generate a code-signing cert (10 years).
openssl req -x509 -newkey rsa:2048 -days 3650 -nodes \
  -keyout /tmp/mnd.key -out /tmp/mnd.crt \
  -subj "/CN=MouseNDeck Dev" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=codeSigning"

# 2. Package and import into the login keychain, pre-authorised for codesign.
openssl pkcs12 -export -legacy -in /tmp/mnd.crt -inkey /tmp/mnd.key \
  -out /tmp/mnd.p12 -password pass:mnd
security import /tmp/mnd.p12 -k ~/Library/Keychains/login.keychain-db \
  -P mnd -T /usr/bin/codesign
rm -f /tmp/mnd.key /tmp/mnd.crt /tmp/mnd.p12

# 3. Keychain Access ▸ find "MouseNDeck Dev" ▸ Get Info ▸ Trust ▸
#    "Code Signing" = Always Trust.   (Requires admin auth.)
```

Then in `/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/host/native/build.sh`:

```bash
swiftc -O -o MouseNDeckInput.app/Contents/MacOS/MouseNDeckInput mdinput.swift

SIGN_ID="${MND_SIGN_ID:-MouseNDeck Dev}"
if security find-identity -v -p codesigning | grep -q "$SIGN_ID"; then
  codesign --force --sign "$SIGN_ID" \
           --identifier dev.mousendeck.input \
           --options runtime \
           MouseNDeckInput.app
else
  echo "warning: '$SIGN_ID' not found; falling back to ad-hoc." >&2
  echo "         Accessibility will need re-granting after every build." >&2
  codesign --force --sign - --identifier dev.mousendeck.input MouseNDeckInput.app
fi

codesign --verify --strict --verbose=2 MouseNDeckInput.app
codesign -d -r- MouseNDeckInput.app   # print the Designated Requirement
```

The printed DR should read approximately:

```
designated => identifier "dev.mousendeck.input" and certificate leaf[subject.CN] = "MouseNDeck Dev"
```

— identity-based, not hash-based. **That is the whole point.** Rebuilds now preserve the grant.

`--options runtime` (hardened runtime) is optional; it is compatible with a self-signed cert for local use, and notarization is neither possible nor needed for a locally built tool.

### Migrating an existing (ad-hoc) grant

Changing the signing identity invalidates the stored `csreq`, producing the worst failure mode: **the toggle looks ON but access is denied.** Clear it explicitly:

```bash
tccutil reset Accessibility dev.mousendeck.input
```

Then relaunch and re-grant once. Add this to the build script's output when it detects a signing-identity change.

### REQ-A5 (summary)

- `build.sh` must produce the `.app` bundle, sign it with a **stable identity**, and print the DR.
- Ad-hoc signing must emit a loud warning naming the consequence.
- `README.md` must document `tccutil reset Accessibility dev.mousendeck.input` as the standard "toggle is on but nothing happens" fix.
- `CFBundleIdentifier` is frozen.

## A.6 Auto-start at login via LaunchAgent — and what it does to TCC attribution

### It **does** change attribution, and naively it changes it for the worse.

Under `launchd`, the parent is `launchd` — the responsibility chain to Terminal is gone. The responsible code becomes **the agent's own program**. If the agent's program is `node`, TCC will demand the Accessibility grant for **`/usr/local/bin/node`** — the exact over-broad grant §A.2 rejects.

### REQ-A6 — the correct split

Run the LaunchAgent as **the Node host only**, and let the Node host `open` the signed injector. The Node host needs **no TCC permission whatsoever** (it never calls CGEvent APIs). TCC then only ever sees `dev.mousendeck.input`.

```
launchd ──▶ node host/server.js        (no TCC needed)
              └─ open -g -n -a MouseNDeckInput.app
                     └─ launchd ──▶ MouseNDeckInput   ← the ONLY TCC subject
```

`~/Library/LaunchAgents/dev.mousendeck.host.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.mousendeck.host</string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/host/server.js</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/Users/satish/Desktop/SKSKNProjects/MOUSENDECK</string>

  <key>RunAtLoad</key>   <true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>

  <!-- Interactive QoS: keeps launchd from throttling the WS hot path.
       Directly relevant to the project's latency requirement. -->
  <key>ProcessType</key> <string>Interactive</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>

  <key>StandardOutPath</key>
  <string>/Users/satish/Library/Logs/mousendeck.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/satish/Library/Logs/mousendeck.err.log</string>

  <!-- Names the job correctly in System Settings ▸ Login Items & Extensions,
       and associates it with our bundle for TCC attribution purposes. -->
  <key>AssociatedBundleIdentifiers</key>
  <array><string>dev.mousendeck.input</string></array>
</dict>
</plist>
```

Load it with the modern subcommands (`load`/`unload` are deprecated):

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.mousendeck.host.plist
launchctl enable   gui/$(id -u)/dev.mousendeck.host
launchctl kickstart -k gui/$(id -u)/dev.mousendeck.host   # restart after edits
launchctl print    gui/$(id -u)/dev.mousendeck.host       # inspect state
launchctl bootout  gui/$(id -u)/dev.mousendeck.host       # remove
```

### Hard constraints

- **It must be a LaunchAgent (`gui/<uid>` domain), never a LaunchDaemon.** CGEvent APIs require a connection to the WindowServer, which exists only in the user's Aqua GUI session. A `LaunchDaemon` in the system domain has no such connection and `CGEventPost` will silently do nothing.
- **`AssociatedBundleIdentifiers` is what makes System Settings name the job correctly.** Quinn: "add the `AssociatedBundleIdentifiers` property to your `launchd` property list" when a daemon/agent "is not correctly attributed to your app" ([thread 678819](https://developer.apple.com/forums/thread/678819)). It is documented in `launchd.plist(5)` ([man page](https://keith.github.io/xcode-man-pages/launchd.plist.5.html)) and is what populates macOS 13+ **System Settings ▸ General ▸ Login Items & Extensions**. Without it the user sees an unnamed background item and is likely to disable it.
- **`SMAppService` is the fully-supported alternative** — it makes the containing app the responsible code — but it requires a real app bundle registering itself at runtime. Overkill here; note it in the README as the path to take if MOUSENDECK ever ships a menu-bar app.
- **The Accessibility grant is unaffected by the LaunchAgent** as long as the injector is launched via `open`, because `open` re-parents it under `launchd` with its own bundle identity either way.

### REQ-A7 — verification

Ship `host/native/verify-tcc.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
APP=host/native/MouseNDeckInput.app
echo "── signature ──"; codesign -dv --verbose=4 "$APP" 2>&1 | grep -E 'Identifier|Authority|Signature|CDHash'
echo "── designated requirement ──"; codesign -d -r- "$APP" 2>&1 | tail -1
PID=$(pgrep -x MouseNDeckInput || true)
if [ -n "$PID" ]; then
  echo "── responsible process ──"; launchctl procinfo "$PID" | grep -i -A1 responsible
else
  echo "MouseNDeckInput not running"
fi
```

Acceptance: the responsible path must equal the app's own executable, **not** a terminal, and not `node`.

---

# PART B — UI Accessibility (WCAG 2.2 AA + Apple HIG)

## B.0 The target device, in numbers

| Property | Value | Source |
|---|---|---|
| Display | 10.2″ diagonal, 4:3 | [Apple iPad (9th generation) tech specs](https://support.apple.com/en-us/111898) |
| Native resolution | 2160 × 1620 px @ 264 ppi | same |
| Logical / CSS resolution | **1080 × 810 CSS px** (2×) | derived |
| Active display area | 8.16″ × 6.12″ (207 × 155 mm) | derived from 10.2″ 4:3 |
| **CSS px density** | **132 CSS px per inch** | 264 ÷ 2 |
| **1 CSS px** | **0.1924 mm** | derived |
| Chassis | 9.8″ × 6.8″ × 0.29″ | user-supplied; matches iPad 9 |
| Home button | Yes — **no notch, no home indicator** | — |
| Safe-area top (standalone, `black-translucent`) | ≈ 20 CSS px | measure with `env(safe-area-inset-top)` |

**Why this table decides the touch-target rule.** The CSS reference pixel assumes ~96 px/inch. This iPad renders at **132 CSS px/inch**, so everything is ~27 % physically smaller than the CSS unit implies:

| Target | CSS px | Physical | Ergonomic verdict |
|---|---|---|---|
| WCAG 2.2 SC 2.5.8 minimum (AA) | 24 | **4.6 mm** | Below the 7–10 mm finger-pad range. Conformant but genuinely hard to hit. |
| Apple HIG absolute minimum (iOS) | 28 | 5.4 mm | Still marginal. |
| **Apple HIG default control size (iOS/iPadOS)** | **44** | **8.5 mm** | **Correct. Also satisfies SC 2.5.5 (AAA).** |

Apple's own numbers, verbatim: **iOS/iPadOS default control size 44×44 pt, minimum control size 28×28 pt**; and on spacing — *"In general, it works well to add about 12 points of padding around elements that include a bezel. For elements without a bezel, about 24 points of padding works well around the element's visible edges."* ([Apple HIG — Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility))

### REQ-B1 — Target size and spacing (normative)

| ID | Requirement |
|---|---|
| B1.1 | Every interactive element has a hit area of **≥ 44 × 44 CSS px**. Applies to the connect button, device rows, deck tiles, page tabs, keyboard keys, gesture rows, sliders' thumbs, sheet close buttons, colour swatches. |
| B1.2 | Nothing may go below **28 × 28 CSS px** under any condition. |
| B1.3 | Anything in the 24–44 px range must additionally satisfy the SC 2.5.8 spacing exception: a 24 px-diameter circle centred on each undersized target's bounding box must not intersect another target or another undersized target's circle — i.e. **≥ 24 px centre-to-centre clearance**. |
| B1.4 | Gutter between deck tiles: **≥ 12 CSS px** (HIG bezeled-element guidance). Keyboard keys: ≥ 6 px, with the 44 px floor already providing separation. |
| B1.5 | The hit area may exceed the painted area. Use `::before { position:absolute; inset:-Npx }` rather than inflating visual chrome. |
| B1.6 | Destructive controls (Delete button, Disconnect) get **≥ 16 px** clearance from their nearest neighbour, and are never placed adjacent to a high-frequency control. |

**Verification:** a Playwright/Puppeteer script that enumerates every element matching `button, [role=button], a, input, [tabindex]`, reads `getBoundingClientRect()`, and fails the build on any box under 44 px in either axis without a documented B1.3 waiver.

### REQ-B2 — Layout budget: trackpad and deck on one screen (requirement 7)

At 1080 × 810 CSS px landscape, standalone:

```
┌──────────────────────────────────────────────────────────────────┐ 20  safe-area-top
│  [Skip]  ●  Connect ▾ / Disconnect · 12:04   ⚙            56 px  │
├───────────────────────────────┬──────────────────────────────────┤
│                               │  ▸ Page tabs                48  │
│        TRACKPAD               │ ┌────┬────┬────┬────┬────┐      │
│        436 × 640              │ │100 │100 │100 │100 │100 │      │  5 cols
│        (aspect ≈ 0.68,        │ ├────┼────┼────┼────┼────┤ 12gap│
│         matches a MacBook     │ │    │    │    │    │    │      │  3 rows
│         trackpad's 1.55:1     │ ├────┼────┼────┼────┼────┤      │
│         rotated)              │ │    │    │    │    │    │      │
│                               │ └────┴────┴────┴────┴────┘      │
│                               │  5×100 + 4×12 = 548              │
├───────────────────────────────┤  ▸ Pointer controls (collapsed)  │
│ [Left  ][Mid][ Right ]    56  │                                  │
└───────────────────────────────┴──────────────────────────────────┘
   16      436        16              580 (grid col)          16
```

- Left column 468 px, right column 596 px, 16 px page margins. Total 1096 → tighten margins to 12 px.
- Content height available: 810 − 20 (safe) − 56 (bar) = **734 px**.
- No vertical scrolling in the default configuration. The deck scrolls internally if a page exceeds 3 rows; the trackpad never scrolls.

Portrait (810 × 1080) stacks: deck on top (3 rows), trackpad below. Switch at a container query, not a device sniff.

## B.1 VoiceOver and ARIA

### B.1.1 The connect / disconnect control (requirement 2)

**Do not use `role="switch"`.** The ARIA APG is explicit: *"It is critical the label on a switch does not change when its state changes"* ([APG Switch Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/switch/)). This control's label *must* change, and worse, the two states are not two values of one setting — **"Connect" opens a chooser; "Disconnect" performs an immediate destructive action.** A switch would announce "Connect, switch, off" and then perform a *disclosure*, which is a lie.

Also **do not use `aria-pressed`** — same reason.

Use one `<button>` with two documented states:

```html
<!-- DISCONNECTED: this is a disclosure. -->
<button id="conn" type="button"
        aria-expanded="false"
        aria-controls="device-list">
  <span class="dot" aria-hidden="true"></span>
  Connect
</button>

<!-- CONNECTED: this is an action. aria-expanded is REMOVED, not set false. -->
<button id="conn" type="button"
        aria-describedby="session-timer">
  <span class="dot ok" aria-hidden="true"></span>
  Disconnect from Satish’s MacBook Pro
</button>
```

Rules:

| ID | Requirement |
|---|---|
| B2.1 | Accessible name must name the target when connected: `Disconnect from {device}`. A bare "Disconnect" gives a VoiceOver user no way to confirm *which* machine they are about to drop. |
| B2.2 | `aria-expanded` exists **only** in the disconnected state. Leaving it as `"false"` while connected tells AT there is a collapsed region that does not exist. |
| B2.3 | The status dot is `aria-hidden="true"` and is **never the sole indicator** (SC 1.4.1 Use of Color). The button's own text carries the state. The dot must additionally differ in **shape**, not only colour: hollow ring = disconnected, filled = connected, filled + concentric ring = reconnecting. |
| B2.4 | State transitions are announced once via a `role="status"` (polite) region: `"Connected to Satish’s MacBook Pro."` / `"Disconnected. Session lasted 12 minutes 4 seconds."` |
| B2.5 | **Reconnect churn must be suppressed.** `public/app.js` currently reconnects with exponential backoff (`300 × 2ⁿ`, capped 5 s) and rewrites `statustext` on every attempt. If that text is ever put in a live region it becomes a screen-reader firehose. Announce a drop only after **2 s** of continuous disconnection, announce recovery only if a drop was announced, and never announce individual retry attempts. |
| B2.6 | Focus after connecting moves to the connect button (now "Disconnect …"), **not** into the deck. The user chose a device; return them to where they were. |

### B.1.2 The device list (requirements 2 & 3)

Every item performs an action (connect). It is **not** a value-selection widget. Use native list semantics — free "list, 4 items" and "3 of 4" announcements, no keyboard code to write:

```html
<ul id="device-list" aria-label="Available devices, most recent first">
  <li>
    <button type="button" class="device"
            aria-describedby="dev-1-meta">
      <span class="dev-name">Satish’s MacBook Pro</span>
      <span id="dev-1-meta" class="dev-meta">
        macOS 26.5 · Online · Last connected 2 hours ago
      </span>
    </button>
  </li>
  <li>
    <button type="button" class="device"
            aria-disabled="true" aria-describedby="dev-2-meta">
      <span class="dev-name">Studio PC</span>
      <span id="dev-2-meta" class="dev-meta">
        Windows 11 · Not reachable on this network
      </span>
    </button>
  </li>
</ul>
```

| ID | Requirement |
|---|---|
| B3.1 | Accessible **name** = device name only. OS, reachability and recency go in `aria-describedby`. Cramming them into the name makes arrowing through the list unbearable. |
| B3.2 | Unreachable devices use **`aria-disabled="true"`, never the `disabled` attribute**. They stay focusable so a VoiceOver user can discover *why* the device is missing. The click handler must no-op and announce the reason. |
| B3.3 | The "most-recently-connected first" ordering is conveyed by DOM order. Do not add "1st", "2nd" to names — `<li>` position is already announced. If the list is ever virtualised, add `aria-posinset` / `aria-setsize`. |
| B3.4 | **The list itself is NOT a live region.** mDNS/LAN discovery churns; `aria-live` on the list would announce every appear/disappear. Instead, a sibling `role="status"` summarises at most every **2 s**: `"3 devices found."` |
| B3.5 | The list is a disclosure controlled by the connect button. Opening it moves focus to the **first** device (short action list — going to a heading first would be an extra step). Closing it (Escape, or connecting) restores focus to the connect button. |
| B3.6 | Long-press / secondary actions (forget device, rename) must **not** be gesture-only. Each row gets a visible "More" button (44×44) — a long-press is a path-independent timing gesture that VoiceOver consumes. |

### B.1.3 The session timer (requirement 2)

**Yes, it needs a role. No, it must not be a chatty live region.**

Use `role="timer"`, whose **implicit `aria-live` value is `off`** — *"Assistive technologies will not announce updates to a timer as it has an implicit `aria-live` value of `off`"* ([MDN, ARIA timer role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/timer_role)). This is exactly the behaviour required: a second-by-second announcement would make the app unusable.

```html
<div id="session-timer" role="timer"
     aria-label="Session time 12 minutes">
  <span aria-hidden="true">12:04</span>
</div>
```

| ID | Requirement |
|---|---|
| B4.1 | Visible `mm:ss` updates every second inside an **`aria-hidden="true"`** span. |
| B4.2 | The **accessible name** (`aria-label`) is updated at most **once per minute**, in words: `"Session time 12 minutes"`. Under a minute: `"Session time under a minute"`. |
| B4.3 | Not `role="status"`, not `aria-live="polite"`, not `aria-atomic`. |
| B4.4 | If an announcement is ever genuinely needed (e.g. host is about to sleep), use MDN's documented technique: swap `role` to `"alert"` for one tick, then back to `"timer"` after ~1 s. Reserve this for at most one event per session. |
| B4.5 | The timer stops and resets on disconnect; the final duration is spoken once in the B2.4 disconnect announcement. |
| B4.6 | The timer is `aria-describedby`-referenced from the Disconnect button so its value is available on demand without hunting for it. |

### B.1.4 The trackpad surface — the hard case

**Facts that constrain the design:**

1. **There is no web equivalent of iOS `UIAccessibilityTraitAllowsDirectInteraction`.** Native apps can declare a Direct Touch region where *"the gestures performed on the screen are not processed by VoiceOver — these gestures 'pass through' directly to the app"* ([Perkins School for the Blind — Direct Touch on iOS](https://www.perkins.org/resource/direct-touch-on-ios/)). Web content cannot: `role="application"` does **not** create a VoiceOver pass-through region in iOS Safari. **With VoiceOver on, the trackpad as currently built is 100 % non-functional** — every drag is consumed by VoiceOver.

2. **SC 2.5.1 Pointer Gestures (Level A):** *"All functionality that uses multipoint or path-based gestures for operation can be operated with a single pointer without a path-based gesture, unless a multipoint or path-based gesture is essential."* Two-finger scroll and two-finger right-click are **multipoint**; a cursor drag whose *path* matters is **path-based**. ([Understanding 2.5.1](https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html))

3. **SC 2.5.7 Dragging Movements (Level AA):** *"All functionality that uses a dragging movement for operation can be achieved by a single pointer without dragging, unless dragging is essential…"* ([Understanding 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html))

**Does the "essential" exception rescue us?** No — and it is important not to hand-wave this. The exception applies when *"information and functionality cannot be achieved in another way."* The *surface* is arguably essential, but the **functions it produces** — move the cursor, click, right-click, scroll, drag — demonstrably *can* be achieved another way (buttons, a D-pad, a drag-lock toggle). So the exception does **not** apply to the derived functions, and an alternative control path is mandatory, not optional.

**`aria-hidden="true"` on the pad is the wrong answer** — it would leave a large invisible dead region that still swallows touches and gives the user no explanation.

#### REQ-B5 — Trackpad specification

```html
<section id="pad-region" aria-labelledby="pad-h">
  <h2 id="pad-h" class="visually-hidden">Trackpad</h2>

  <div id="pad" role="application"
       aria-roledescription="Trackpad"
       aria-label="Trackpad. Moves the pointer on Satish’s MacBook Pro."
       aria-describedby="pad-help"
       tabindex="0">
    <p id="padhint" aria-hidden="true">drag to move · tap to click</p>
  </div>

  <p id="pad-help" class="visually-hidden">
    Touch gestures are not available with VoiceOver. Use the arrow keys, or open
    Pointer controls for buttons that move, click and scroll.
  </p>

  <!-- MUST live OUTSIDE #pad: with VoiceOver on, the pad cannot be swiped,
       so any control inside it is unreachable. -->
  <button type="button" id="pointer-controls-toggle"
          aria-expanded="false" aria-controls="pointer-controls">
    Pointer controls
  </button>
  <div id="pointer-controls" role="group" aria-label="Pointer controls" hidden>
    …
  </div>
</section>
```

| ID | Requirement |
|---|---|
| B5.1 | `role="application"` + `aria-roledescription="Trackpad"` + a real `aria-label`. On desktop screen readers this yields focus-mode key pass-through, which genuinely helps the laptop-browser path. On iOS it is inert but harmless, and it stops VoiceOver reading the decorative hint text. |
| B5.2 | The hint paragraph inside the pad is `aria-hidden="true"`; the real instructions live in `#pad-help`, referenced by `aria-describedby`. |
| B5.3 | `tabindex="0"` plus **full keyboard operability** (SC 2.1.1): arrows nudge 8 px; `Shift`+arrow = 40 px; `Alt`+arrow = 1 px; `Space`/`Enter` = left click; `c` or `ContextMenu` = right click; `m` = middle click; `PageUp`/`PageDown` = scroll; `Shift`+`PageUp/Down` = horizontal scroll; `d` = toggle drag lock. Held arrows accelerate after 400 ms. |
| B5.4 | **Pointer controls panel** (the SC 2.5.1 / 2.5.7 conformance path). Eight direction buttons in a D-pad, plus: Click, Right-click, Middle-click, Scroll up, Scroll down, and a **drag-lock toggle** (`<button aria-pressed>` labelled "Hold left button"). Drag lock is what makes dragging achievable without a dragging movement. Every button ≥ 44 px. |
| B5.5 | The panel toggle lives **outside** `#pad`, in the DOM before it, and its state persists per device. |
| B5.6 | `touch-action: none` on `#pad` **only** — never on `<body>`. |
| B5.7 | Two-finger scroll, two-finger tap and any three-finger gesture must each have a labelled single-pointer equivalent in the panel. Ship a mapping table in the docs. |
| B5.8 | Announce drag-lock state changes via the shared `role="status"`: `"Left button held."` / `"Left button released."` A silently latched mouse button is a trap. |
| B5.9 | The pad's visible boundary must have **≥ 3:1** contrast against the page background (SC 1.4.11 Non-text Contrast) — it is the only cue that the region exists. |

### B.1.5 Deck buttons (requirements 5, 6)

```html
<div role="grid" aria-labelledby="deck-page-name" class="deck">
  <div role="row">
    <div role="gridcell">
      <button type="button" tabindex="0"
              aria-describedby="tip-copy">
        <span class="ico" aria-hidden="true">⧉</span>
        <span class="lbl">Copy</span>
      </button>
      <span id="tip-copy" hidden>Command C</span>
    </div>
    …
  </div>
</div>
```

| ID | Requirement |
|---|---|
| B6.1 | **Icon spans are `aria-hidden="true"`.** Today `public/app.js` renders `b.icon \|\| '●'` as visible text with no ARIA, so VoiceOver literally announces **"black circle"** before every label. Emoji icons are worse ("party popper"). |
| B6.2 | Accessible name = the **effect**, not the glyph: "Copy", not "two squares". If a tile has no label, `aria-label` is synthesised from the action (`"Command C"`, `"Open Safari"`, `"Mute"`). A tile can never be nameless. |
| B6.3 | The key combination goes in `aria-describedby`, spelled in words (`"Command Shift 4"`), not symbols (`⌘⇧4` reads as garbage or is skipped entirely). |
| B6.4 | **No `aria-pressed` on momentary actions.** Add `aria-pressed` only for tiles whose action is latching (`mute`, `hold modifier`, `drag lock`); mark these in the action schema with `latching: true` so the renderer is data-driven. |
| B6.5 | **Grouping — use the APG layout grid.** The APG notes a layout grid *"dramatically reduces the number of tab stops on a page"* and is intended for *"grouping a set of interactive elements, such as links, buttons, or checkboxes"* ([APG Grid Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)). A 5×3 deck becomes **one** tab stop instead of fifteen — decisive with a hardware keyboard. Roving `tabindex`; Arrows move within/between rows; Home/End = row ends; Ctrl+Home/End = grid ends. |
| B6.6 | Pages are a `role="tablist"` of `role="tab"` with `aria-selected`, controlling `role="tabpanel"` regions labelled by their tab. Roving tabindex, Left/Right/Home/End. `public/app.js`'s current plain buttons give no selected state to AT. |
| B6.7 | The deck grid has `aria-labelledby` pointing at the current page name, so context is spoken on entry. |

#### REQ-B7 — Pointer cancellation on deck tiles (SC 2.5.2, Level A) — **current code fails this**

`makeTile()` in `/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/public/app.js` fires the action on `touchstart` with `preventDefault()`. SC 2.5.2 requires one of: no down-event execution; completion on up-event *with* an abort mechanism; up-event reversal; or the function being **essential** on the down-event. The Understanding document's essential examples are keyboard *emulation*, an on-screen piano, and a timing-critical game ([Understanding 2.5.2](https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html)). **A macro deck that launches apps, runs shell commands and executes AppleScript is not a piano** — an accidental touch that runs a shell command is exactly the harm the criterion exists to prevent.

| ID | Requirement |
|---|---|
| B7.1 | Default: **arm on `pointerdown`, commit on `pointerup` inside the tile's bounds.** Sliding off cancels. This satisfies condition 2 ("a mechanism is available to abort the function before completion"). |
| B7.2 | Visual + audio press feedback still fires on `pointerdown`, so perceived responsiveness is unchanged. The only added delay is the user's own finger-lift time (typically 50–100 ms) — **not** added system latency. Say so in the settings copy. |
| B7.3 | An opt-in **"Instant press"** setting may restore down-event firing for latency purists. It must be off by default, must carry an inline explanation of what it disables, and must be forced off for tiles whose action type is `shell` or `applescript`. |
| B7.4 | **Bug in current code:** `let fired = false` is set `true` on `touchstart` and cleared **only inside the `click` handler**. A `touchstart` followed by `touchcancel` (system gesture, notification banner, palm rejection) leaves `fired === true`, so the *next* activation is swallowed. VoiceOver's double-tap synthesises a `click` with **no** preceding `touchstart` — so after any cancelled touch, **the first VoiceOver activation of that tile is silently dropped**. Clear the flag in the `touchend`/`touchcancel` handler, or replace the whole thing with Pointer Events. |
| B7.5 | Migrate to Pointer Events (`pointerdown`/`pointerup`/`pointercancel` + `setPointerCapture`). One code path for touch, pen, mouse and VoiceOver's synthetic clicks; deletes the `fired` hack entirely. |

#### REQ-B8 — Edit mode, delete and restore (requirement 6)

Entering edit mode silently repurposes every tile from "run" to "edit". That is a large, unannounced semantic change.

| ID | Requirement |
|---|---|
| B8.1 | Announce mode entry once via `role="status"`: `"Editing deck. Buttons now open the editor."` |
| B8.2 | In edit mode each tile's accessible name becomes `"Edit {label}"`. Do not rely on a visual jiggle. |
| B8.3 | `prefers-reduced-motion: reduce` must **suppress the jiggle animation** and substitute a persistent static affordance (dashed outline + corner badge). The affordance must never be motion-only. |
| B8.4 | Delete is **not** immediate destruction: it moves the tile to a per-device **Removed** bin. `role="status"` announces `"Copy removed. Undo available in the deck editor."` |
| B8.5 | **Focus after deletion** moves to the tile now occupying the deleted tile's grid position, or to the Add button if the page is empty. Never leave focus on a removed node — focus falls to `<body>` and VoiceOver loses its place entirely. |
| B8.6 | The built-in catalogue (requirement 6, "fast way to re-add built-ins") is a `<dialog>` containing a searchable `role="listbox"` of built-ins, each row showing name + key combo + a checkmark if already on the board (`aria-selected`). Adding announces `"Copy added to Page 1."` |
| B8.7 | Catalogue entries unsupported by the connected device (requirement 4) are `aria-disabled="true"` with a reason in `aria-describedby`, and are **not** hidden — a hidden item cannot explain its own absence. Announce the count on open: `"8 shortcuts unavailable on Windows targets."` |
| B8.8 | Requirement 4's hard constraint ("must NOT be able to add a button the target device cannot perform") is enforced **server-side** in `host/actions.js` as well as in the UI. A disabled control is a hint, not a security boundary. |

### B.1.6 Shared announcement channel

One polite region for the whole app; one assertive region reserved for errors.

```html
<div id="a11y-status"  role="status" aria-live="polite"   class="visually-hidden"></div>
<div id="a11y-alert"   role="alert"  aria-live="assertive" class="visually-hidden"></div>
```

- Never write to `#a11y-alert` for routine state. Reserve it for: permission denied, host unreachable after final retry, action failed.
- Coalesce: writing the same string twice within 2 s is a no-op.
- Clear the node before writing (`el.textContent=''; requestAnimationFrame(()=>el.textContent=msg)`) so repeated identical messages are re-announced when they *are* intentional.
- `.visually-hidden` must use the clip-path technique, **not** `display:none` (which removes it from the a11y tree) and not `visibility:hidden`.

## B.2 Media queries

### REQ-B9 — `prefers-reduced-motion`

Apple's guidance: *"reducing automatic and repetitive animations, including zooming, scaling, and peripheral motion … Replacing transitions in x-, y-, and z-axes with fades to avoid motion"* ([HIG Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)).

| Element | Default | `reduce` |
|---|---|---|
| Settings / editor sheet | slide-up 240 ms | opacity fade ≤ 100 ms, no transform |
| Deck tile press | `scale(0.94)` | background-lightness change only |
| Connect button "connecting" | pulsing ring | static ring + text change |
| Device list reveal | staggered rows | instant |
| Edit-mode jiggle | rotate loop | **removed**; static dashed outline (see B8.3) |
| Latency graph | sweeping line | numeric readout only |

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Then re-enable the small opacity fades explicitly. **Never remove the feedback — only the motion.**

### REQ-B10 — `prefers-contrast: more`

Maps to **Settings ▸ Accessibility ▸ Display & Text Size ▸ Increase Contrast** on iPadOS ([tempertemper](https://www.tempertemper.net/blog/using-the-increased-contrast-mode-css-media-query), [a11y-blog](https://a11y-blog.dev/en/articles/css-media-features-for-a11y/)).

- All text to **≥ 7:1**.
- Every deck tile, the trackpad, and every sheet get a **2 px solid** border at ≥ 4.5:1 against the page.
- Remove all `backdrop-filter: blur()` and all translucency; solid fills only.
- Focus ring thickens 2 px → **3 px**.
- Dividers and disabled-state dimming raised to ≥ 3:1.

Also honour `prefers-reduced-transparency: reduce` — sheet backdrops become fully opaque.

### REQ-B11 — `prefers-color-scheme`

The app is currently dark-only (`theme-color #0a0a0f`, `public/style.css`).

| ID | Requirement |
|---|---|
| B11.1 | Author a **real light theme**. `filter: invert()` is forbidden — it destroys the deck's semantic colours and photographic icons. |
| B11.2 | Both themes independently meet: **4.5:1** body text; **3:1** for ≥ 18 pt or ≥ 14 pt bold; **3:1** non-text (SC 1.4.11) for tile borders, the pad outline, focus rings, the status dot, slider tracks and thumbs. Apple's HIG publishes the same table: *up to 17 pt → 4.5:1; 18 pt → 3:1; bold → 3:1*. |
| B11.3 | `<meta name="theme-color">` needs a `media`-qualified pair. |
| B11.4 | A manual theme override in Settings (Auto / Light / Dark) — some low-vision users need the opposite of their system setting. Persist per device board. |

#### The tile palette fails contrast today — computed, not asserted

`COLORS` in `public/app.js` with white labels:

| Swatch | Relative luminance | vs `#fff` | vs `#000` | Verdict |
|---|---|---|---|---|
| `#3b82f6` | 0.2355 | **3.68:1** | 5.71:1 | White text **fails** 4.5:1 |
| `#f59e0b` | 0.4389 | **2.15:1** | 9.78:1 | White text **fails badly** |

| ID | Requirement |
|---|---|
| B11.5 | Compute the label colour **per tile at runtime**: pick black or white by measured contrast; if neither reaches **4.5:1**, adjust the tile's background lightness until one does. Ship the WCAG relative-luminance function; do not eyeball it. |
| B11.6 | **Two-tone focus ring.** On a `#3b82f6` tile, a 3:1 ring requires luminance ≥ 0.807 (near-white) or ≤ 0.045 (near-black). Since tile colours are user-chosen, use a 2 px white ring with a 1 px black outer stroke (or the reverse) so **3:1 is guaranteed on every possible tile colour**. |
| B11.7 | Colour swatches in the editor need **text names** ("Blue", "Amber"), not colour alone (SC 1.4.1), and `aria-pressed` for the selected one. |
| B11.8 | Under `forced-colors: active` (desktop path), use `Canvas`/`CanvasText`/`ButtonFace`/`Highlight`. Apply `forced-color-adjust: none` **only** to the colour swatches, where colour is the information — and only because B11.7 provides the name. |

## B.3 Dynamic Type and text scaling in a fixed control surface

### REQ-B12 — Remove the zoom lock (**current defect, SC 1.4.4 Resize Text, AA**)

`/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/public/index.html` line 5:

```html
<meta name="viewport" content="width=device-width, initial-scale=1,
      maximum-scale=1, user-scalable=no, viewport-fit=cover">
```

`maximum-scale=1, user-scalable=no` is a direct SC 1.4.4 failure. iOS Safari has ignored it since iOS 10, but it still applies in `WKWebView` and signals the wrong intent. Replace with:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

Prevent double-tap zoom **only** where it breaks gestures, via CSS on the element:

```css
#pad { touch-action: none; }
.tile, .key { touch-action: manipulation; }   /* kills the 300ms delay, keeps zoom */
```

Also: `html { -webkit-text-size-adjust: 100%; }` — never `none`.

### REQ-B13 — Adopt Dynamic Type

iOS communicates the user's preferred text size to web content through `font: -apple-system-body`, which *"sets size, font-family, weight, font-variant, and line-height"*, so **all `rem`-based values then scale with user preference** ([WebKit — Using the System Font in Web Content](https://webkit.org/blog/3709/using-the-system-font-in-web-content/), [colingourlay](https://dev.to/colingourlay/how-to-support-apple-s-dynamic-text-in-your-web-content-with-css-40c0), [furbo.org](https://furbo.org/2024/07/04/dynamic-type-on-the-web/)).

**Gate it to touch**, because on desktop Safari the same query drops the baseline from 16 px to 13 px:

```css
@supports (font: -apple-system-body) {
  @media (pointer: coarse) {
    :root { font: -apple-system-body; font-family: system-ui, sans-serif; }
  }
}
```

Then express **all** typography, padding and gaps in `rem`.

### REQ-B14 — Reflow rules for a fixed control surface

Apple asks for **200 %** text enlargement; WCAG SC 1.4.4 requires 200 % without loss of content or function. A deck of fixed 100 px tiles cannot simply grow. Rules:

| ID | Requirement |
|---|---|
| B14.1 | Tile **geometry** stays fixed (`--tile: 6.25rem`); tile **text** scales but is clamped: `font-size: clamp(0.7rem, 0.85rem, 1rem)`, `line-height: 1.2`, two-line clamp with ellipsis. |
| B14.2 | Truncating the **visible** label is acceptable **only because** the full string is always the accessible name and is shown in full in the editor and catalogue. **Never truncate `aria-label`.** |
| B14.3 | **Above a threshold, change the layout, don't shrink the text.** When the computed root font-size exceeds **20 px** (the larger Dynamic Type steps and all AX sizes), the deck switches from an icon grid to a **single-column list**: full-width rows, icon left, complete untruncated label, 56 px row height. This is the reflow answer for a control surface, and it is far better than a grid of ellipses. Detect with a `ResizeObserver` on a 1 rem probe element, or a container query — never a device or OS sniff. |
| B14.4 | In list mode the trackpad occupies the full width above the list (portrait-style stack), preserving requirement 7 (both visible) at every text size. |
| B14.5 | The trackpad contains no scaling text at all — its instructions live in `#pad-help`. It is inherently immune. |
| B14.6 | **SC 1.4.12 Text Spacing (AA):** the UI must survive `line-height: 1.5`, `letter-spacing: 0.12em`, `word-spacing: 0.16em`, paragraph spacing `2em` with no loss of content or function. Tiles must **clip**, never overlap. Add the standard Text Spacing bookmarklet CSS to the visual-regression suite. |
| B14.7 | Deck column count is user-configurable (2–8 today). Clamp the **maximum** so tiles never fall below 44 px at the current root font size; disable out-of-range steps with `aria-disabled` and a reason, rather than allowing an unusable board. |

## B.4 Focus management, sheets, and hardware keyboards

### REQ-B15 — Sheets become `<dialog>`

`public/index.html` uses `<div class="sheet">` toggled by a class. Replace with native `<dialog>` + `showModal()`, supported in Safari/iPadOS 15.4+. This gives, for free: top layer, background inertness, Escape-to-close, and a focus trap.

| ID | Requirement |
|---|---|
| B15.1 | `<dialog>` + `showModal()`, `aria-labelledby` on the `<h2>`. |
| B15.2 | **Focus on open → the dialog's heading**, given `tabindex="-1"`. Focusing the first input skips the title, so a VoiceOver user hears "Label, text field" with no idea which sheet opened. *Exception:* the device chooser focuses the first device (short action list), and the keyboard picker focuses its search field (§B.5). |
| B15.3 | **Focus on close → always the invoking element.** If it no longer exists (deleted tile), fall back to the grid container. |
| B15.4 | Escape closes. **See B16.4** — Escape is currently stolen by the keyboard passthrough. |
| B15.5 | Fallback path (if `<dialog>` is unavailable): `role="dialog"` + `aria-modal="true"` + the `inert` attribute on `#app` + a manual trap. Do **not** rely on `aria-modal` alone; it does not stop Tab. |
| B15.6 | `::backdrop` must be ≥ 50 % opaque **and** honour `prefers-reduced-transparency`. |

### REQ-B16 — Focus visibility and the sticky-chrome problem

| ID | Requirement |
|---|---|
| B16.1 | **SC 2.4.11 Focus Not Obscured (Minimum), AA:** *"When a user interface component receives keyboard focus, the component is not entirely hidden due to author-created content."* The app has a sticky `#bar` header (56 px) **and** a sticky `#tabs` footer. Tabbing a long settings sheet slides the focused control under them. Fix per the Understanding doc's own recommendation (CSS scroll-padding): `scroll-padding-block: 76px 80px` on every scroll container, plus `scroll-margin-block: 8px` on focusable descendants. ([Understanding 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)) |
| B16.2 | Use `:focus-visible`, never bare `:focus` (which paints a ring on every touch tap). |
| B16.3 | Focus indicator: **≥ 2 px** thick, **1 px offset**, **≥ 3:1** against both the focused control and the adjacent background (SC 1.4.11). Two-tone per B11.6. `outline: none` without a replacement is forbidden. |
| B16.4 | **`outline` must not be removed on the trackpad** — it is the only cue that keyboard nudging is armed. |

### REQ-B17 — Hardware keyboard on the iPad

iPadOS **Full Keyboard Access** (Settings ▸ Accessibility ▸ Keyboard ▸ Full Keyboard Access) drives Safari through DOM tab order.

| ID | Requirement |
|---|---|
| B17.1 | Tab order equals visual order. **No positive `tabindex` anywhere.** |
| B17.2 | With the layout-grid patterns (B6.5, B6.6), the whole tab sequence is: skip link → connect → \[device list] → trackpad → pointer-controls toggle → deck grid (1 stop) → page tabs (1 stop) → settings. Roughly **8 stops** for the entire app. |
| B17.3 | **SC 2.4.1 Bypass Blocks:** a visible-on-focus skip link as the first focusable element: "Skip to deck". |
| B17.4 | Every control operable with Space and/or Enter; no mouse-only affordances. |
| B17.5 | **SC 2.1.4 Character Key Shortcuts (A):** any single-character local shortcut must be remappable, disableable, or active only while the relevant component has focus. The pad's `c`/`m`/`d` keys (B5.3) qualify under "active only on focus" — document this. Do **not** add global single-letter shortcuts. |

### REQ-B18 — The keyboard passthrough is a keyboard trap (**current defect, SC 2.1.2, Level A**)

In `/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/public/app.js`, `#kbinput`'s `keydown` handler maps `Escape → 'escape'` and `Tab → 'tab'` and calls `e.preventDefault()` before forwarding. **Once focus enters that field, neither Tab nor Escape can move focus out.** That is a Level A failure and it also collides with `<dialog>`'s Escape handling (B15.4).

| ID | Requirement |
|---|---|
| B18.1 | Passthrough must be **explicitly armed** by a toggle *outside* the field (`<button aria-pressed>`), and disarmed the same way. |
| B18.2 | Reserve a **documented escape hatch that is never forwarded**: the *second* `Escape` within 500 ms exits the field and returns focus to the toggle. The first is forwarded. WCAG 2.1.2 permits a trap when *"the user is advised of the method for moving focus away"* — so this must be stated in the field's `aria-describedby` and shown visibly: *"Press Escape twice to stop sending keys."* |
| B18.3 | `Tab` is forwarded **only while armed**. While disarmed, `Tab` moves focus normally. |
| B18.4 | Passthrough is **force-disarmed whenever any `<dialog>` is open** (`document.querySelector('dialog[open]')`), and the passthrough field must never be placed inside a dialog. |
| B18.5 | Armed state is announced once via `role="status"`: `"Sending keystrokes to Satish’s MacBook Pro."` / `"Stopped sending keystrokes."` A silently armed passthrough that swallows a user's `⌘Q` is a serious hazard. |
| B18.6 | Armed state has a **persistent, non-colour visual indicator** (border + text label), not just a tint. |
| B18.7 | Auto-disarm on blur, on WebSocket close, and after 60 s of inactivity. |

### REQ-B19 — Replace `prompt()` / `confirm()`

`renamePage()` in `public/app.js` uses `prompt()` and `confirm()`. These give no `aria-labelledby`, no focus restoration, are suppressed in some standalone-PWA contexts, and encode a destructive delete inside a rename dialog ("clear the name to delete the page") — an undiscoverable, unannounced destructive path. Replace with `<dialog>` forms per B15, and give page deletion its own labelled, confirmable, undoable control.

## B.5 The full visual keyboard picker (requirement 9)

The hardest accessibility problem in the product: 100+ targets, read one at a time, is hostile. The answer is **three layers, with search as the default**.

### REQ-B20 — Layer 1: search first (the primary path)

The picker opens with a search field focused. Most users never touch the grid.

```html
<label for="key-search">Find a key</label>
<input id="key-search" type="text" role="combobox"
       aria-expanded="true" aria-controls="key-grid-main"
       aria-autocomplete="list" aria-activedescendant="key-VolumeUp"
       autocomplete="off" autocapitalize="off" spellcheck="false">
<div id="key-search-count" role="status" class="visually-hidden"></div>
```

| ID | Requirement |
|---|---|
| B20.1 | Typing filters; `aria-activedescendant` follows the best match; ↑/↓ walk matches; Enter selects. Focus never leaves the input. |
| B20.2 | Match count announced via `role="status"`, **debounced 500 ms**: `"3 keys match."` Never `assertive`. |
| B20.3 | Search matches names, aliases and glyphs: `"cmd"`, `"command"`, `"⌘"`, `"win"`, `"meta"` all find the same key. Alias table is device-OS aware. |
| B20.4 | Above the grid, two collapsed-by-default disclosures: **Recently used** and **Common shortcuts for macOS / Windows** (per the connected device). |

### REQ-B21 — Layer 2: the grid, split into named blocks

One monolithic 100-key grid defeats the rotor. Split into `role="group"`s, each containing its own `role="grid"`:

| Block | Keys | Tab |
|---|---|---|
| Function row | Esc, F1–F12 | Main |
| Number row | `` ` `` 1–0 - = ⌫ | Main |
| QWERTY block | 3 letter rows + punctuation | Main |
| Modifiers | ⇪ ⇧ ⌃ ⌥ ⌘ Fn Space | Main |
| Navigation | ⌦ ⇱ ⇲ ⇞ ⇟ + arrows | More |
| Numpad | 0–9 . / \* − + ⏎ NumLock | More |
| Media | Play/Pause, Next, Prev, Vol ±, Mute, Brightness ± | Media |

| ID | Requirement |
|---|---|
| B21.1 | Each block: `<div role="group" aria-label="Function row">` wrapping `<div role="grid" aria-label="Function row keys">`. VoiceOver's rotor then lists the blocks, so a user jumps to "Numpad" in one gesture. |
| B21.2 | Per-block roving tabindex; **exactly one** key in the entire picker has `tabindex="0"`. |
| B21.3 | Keyboard interaction per the APG grid pattern: ←/→ within a row; ↑/↓ across rows; Home/End = row ends; **Ctrl+Home/Ctrl+End = block ends**; PageUp/PageDown = previous/next block. Enter/Space selects. |
| B21.4 | **The staggered-row rule.** Real keyboard rows have unequal key counts and half-unit offsets, so naive index-based ↑/↓ feels broken. Store each key with a fractional column position and width in key-units (`{x: 1.5, w: 1.75}`); ↑/↓ selects the key in the target row whose **horizontal centre is nearest** the current key's centre. This is a concrete, testable rule — write unit tests for it. |
| B21.5 | Layout is data-driven per target OS: `ansi-mac`, `ansi-win`, plus room for ISO. Never hard-code. |
| B21.6 | Key size **≥ 44 CSS px**; at 1080 px landscape a 15-unit main block at 56 px/unit + 6 px gaps = **924 px**, which fits comfortably. Numpad and navigation go in the "More" tab rather than being squeezed in. |

### REQ-B22 — Accessible names for keys (the detail that decides usability)

The glyph is never the accessible name.

```html
<div role="gridcell">
  <button type="button" tabindex="-1" aria-label="Command" aria-pressed="false">
    <span aria-hidden="true">⌘</span>
  </button>
</div>
```

| ID | Requirement |
|---|---|
| B22.1 | Glyph in an `aria-hidden="true"` span; the **word** in `aria-label`. |
| B22.2 | **Names follow the connected device's OS** (requirement 4): `⌘` → "Command" on macOS, "Windows key" on Windows. `⌥` → "Option" / "Alt". `⌫` → "Delete" / "Backspace". `⏎` → "Return" / "Enter". |
| B22.3 | **Punctuation must be spelled out**, always: `;` → "Semicolon", `/` → "Slash", `` ` `` → "Backtick", `\` → "Backslash", `[` → "Left bracket". VoiceOver's punctuation-verbosity setting otherwise skips them entirely, producing **silent keys**. This is the single most common defect in visual keyboard pickers. |
| B22.4 | Arrows: "Up Arrow", not "▲". Modifiers: "Caps Lock", "Escape", "Tab". |
| B22.5 | Letter keys: `aria-label="A"` — a bare "a" may be read as the article. Keep the visible glyph uppercase and the label uppercase. |

### REQ-B23 — Modifier state and combination preview

| ID | Requirement |
|---|---|
| B23.1 | Modifier keys are toggles: `aria-pressed` on the **`<button>`**, never on the `role="gridcell"` wrapper (`aria-pressed` is invalid on `gridcell`). Hence the nested `gridcell > button` structure above. |
| B23.2 | A `role="status"` (polite) preview reads the accumulating combination **in words**, debounced 300 ms: `"Command Shift 4 selected."` Never `assertive`. |
| B23.3 | A visible chip row mirrors it, in the target OS's own order (macOS: ⌃⌥⇧⌘ + key; Windows: Ctrl+Alt+Shift+Win + key). |
| B23.4 | A "Clear" button (≥ 44 px) resets all modifiers and announces `"Combination cleared."` |
| B23.5 | Selecting a non-modifier key **completes** the combination and closes the picker, returning focus to the field that opened it. |

### REQ-B24 — Unavailable keys (requirement 4)

| ID | Requirement |
|---|---|
| B24.1 | Keys the target cannot send get `aria-disabled="true"` — **focusable, dimmed, and explained** via `aria-describedby`: *"Not available on Windows targets."* |
| B24.2 | **Never `display:none`.** Hiding them shifts the layout between devices and destroys spatial muscle memory; worse, a hidden key cannot explain its own absence. |
| B24.3 | Dimming must not be colour-only (SC 1.4.1): add a **diagonal hatch** or a slashed-circle badge at ≥ 3:1. |
| B24.4 | On open, announce the count once: `"8 keys unavailable on this device."` |
| B24.5 | Activating a disabled key announces the reason rather than doing nothing silently. |

### REQ-B25 — The trackpad-gesture picker (requirement 9, second half)

**Selecting a gesture must never require performing it.** A picker that says "do the gesture to record it" is unusable with VoiceOver (which consumes the gesture), with a hardware keyboard, and for anyone with limited dexterity — and it would fail SC 2.5.1 in the authoring UI itself.

```html
<div role="radiogroup" aria-labelledby="gest-h"
     aria-describedby="gest-note">
  <h3 id="gest-h">Trackpad gestures — macOS</h3>
  <p id="gest-note">Choose a gesture from the list. You do not need to perform it.</p>

  <div role="radio" aria-checked="false" tabindex="0"
       aria-describedby="g-3up-desc">
    <span class="g-name">Three-finger swipe up</span>
    <span id="g-3up-desc" class="g-desc">Opens Mission Control</span>
    <svg class="g-demo" aria-hidden="true" focusable="false">…</svg>
  </div>
  …
</div>
```

| ID | Requirement |
|---|---|
| B25.1 | `role="radiogroup"` of `role="radio"`, roving tabindex, arrow-key navigation, Space selects (APG radio-group pattern). |
| B25.2 | Two catalogues, chosen by the connected device's OS: **macOS trackpad** and **Windows precision touchpad**. Single/double/triple-finger taps, swipes (4 directions × 2/3/4 fingers), pinch, spread, rotate, force click, edge swipes. |
| B25.3 | Accessible name = the gesture; `aria-describedby` = what it does on that OS. Both are required — "three-finger swipe up" alone is meaningless without "Mission Control" / "Task View". |
| B25.4 | Demo animations are `aria-hidden="true" focusable="false"`, **silent**, and **suppressed under `prefers-reduced-motion`** (replaced by a static numbered-dot diagram with a text description). |
| B25.5 | Gestures the target OS lacks: `aria-disabled="true"` + reason, exactly as B24. |
| B25.6 | Rows ≥ 56 CSS px tall (they carry two lines of text) and full-width. |
| B25.7 | An optional "Record by performing it" path may exist **as an alternative**, never as the only path, and must be skippable by keyboard. |

## B.6 Structure, landmarks, and the manifest

| ID | Requirement |
|---|---|
| B26.1 | `<html lang="en">` — already correct in `public/index.html`. |
| B26.2 | Landmarks: `<header>`, `<main>`, `<nav aria-label="Views">`. The current `<nav id="tabs">` has no label; add one. Give `<main>` an `aria-label` if more than one exists. |
| B26.3 | A real heading outline: `<h1>` (visually hidden, "MouseNDeck"), `<h2>` per major region (Trackpad, Deck, Settings). None exist today; VoiceOver's heading rotor is currently empty. |
| B26.4 | The view switcher (`#tabs`) is a `role="tablist"` with `aria-selected` — currently plain buttons with a `.active` class that AT cannot see. |
| B26.5 | Do **not** mutate `document.title` on connection-state change; some AT announces every title change. |
| B26.6 | `manifest.webmanifest`: `"display": "standalone"`, `"orientation": "any"` (never lock — SC 1.3.4 Orientation, AA), `"lang": "en"`, `"dir": "ltr"`, and both light/dark `theme_color` handled via the `media`-qualified meta tags. |
| B26.7 | **Non-visual feedback:** iOS Safari does not expose the Vibration API and a PWA cannot trigger Taptic Engine feedback — verify this on the target iPadOS build before relying on it. Because haptics are unavailable, provide an **optional short WebAudio click** on tile activation (off by default, toggleable in Settings). For a low-vision user this may be the only confirmation that a macro fired. Note that iOS respects the ring/silent switch for WebAudio in some configurations — surface a "test sound" button so the user can confirm. |
| B26.8 | Provide a **"Reduce trackpad sensitivity"** and a **"Larger targets"** preference (bumps `--tile` and key size from 44 → 56 px). Motor-accessibility settings that no media query can infer. |

## B.7 Conformance summary and acceptance criteria

### Success criteria explicitly addressed

| SC | Level | Where |
|---|---|---|
| 1.3.1 Info and Relationships | A | B6.5, B6.6, B26.2–4 |
| 1.3.4 Orientation | AA | B26.6 |
| 1.4.1 Use of Color | A | B2.3, B11.7, B24.3 |
| 1.4.3 Contrast (Minimum) | AA | B11.2, B11.5 |
| 1.4.4 Resize Text | AA | **B12 (current defect)**, B13, B14 |
| 1.4.10 Reflow | AA | B14.3 |
| 1.4.11 Non-text Contrast | AA | B5.9, B11.2, B16.3 |
| 1.4.12 Text Spacing | AA | B14.6 |
| 2.1.1 Keyboard | A | B5.3, B17 |
| 2.1.2 No Keyboard Trap | A | **B18 (current defect)** |
| 2.1.4 Character Key Shortcuts | A | B17.5 |
| 2.4.1 Bypass Blocks | A | B17.3 |
| 2.4.3 Focus Order | A | B15.2–3, B17.1 |
| 2.4.7 Focus Visible | AA | B16.2–3 |
| 2.4.11 Focus Not Obscured (Min) | AA | B16.1 |
| 2.5.1 Pointer Gestures | A | **B5.4, B5.7, B25** |
| 2.5.2 Pointer Cancellation | A | **B7 (current defect)** |
| 2.5.5 Target Size (Enhanced) | AAA | B1.1 (44 px meets AAA) |
| 2.5.7 Dragging Movements | AA | **B5.4 (drag lock)** |
| 2.5.8 Target Size (Minimum) | AA | B1.1–1.3 |
| 3.2.3 Consistent Navigation | AA | B26.4 |
| 4.1.2 Name, Role, Value | A | B1–B25 throughout |

### Open defects found in the current code

| # | File | Defect | SC |
|---|---|---|---|
| 1 | `public/index.html` line 5 | `maximum-scale=1, user-scalable=no` blocks zoom | 1.4.4 (AA) |
| 2 | `public/app.js` `#kbinput` keydown | `Escape` and `Tab` are `preventDefault`ed and forwarded → focus can never leave the field | 2.1.2 (**A**) |
| 3 | `public/app.js` `makeTile()` | Action fires on `touchstart`, no abort, no undo; `shell`/`applescript` actions are irreversible | 2.5.2 (**A**) |
| 4 | `public/app.js` `makeTile()` | `fired` flag cleared only in the `click` handler → after a `touchcancel`, the next activation (including VoiceOver's synthetic click) is silently swallowed | 4.1.2 / functional |
| 5 | `public/app.js` `makeTile()` | Icon span not `aria-hidden`; default `●` announced as "black circle" | 1.3.1 |
| 6 | `public/app.js` `COLORS` | `#3b82f6` gives 3.68:1 and `#f59e0b` gives 2.15:1 against white labels | 1.4.3 (AA) |
| 7 | `public/index.html` `#dot` | Connection state conveyed by colour alone | 1.4.1 (A) |
| 8 | `public/index.html` `#tabs`, `#pagebar` | Tabs are plain buttons; no `tablist`/`aria-selected` | 1.3.1, 4.1.2 |
| 9 | `public/app.js` `renamePage()` | `prompt()`/`confirm()`; destructive delete hidden inside a rename flow | 3.3.4, 4.1.2 |
| 10 | `public/index.html` | No headings at all; heading rotor is empty | 1.3.1 |
| 11 | `public/style.css` | Dark theme only; no `prefers-color-scheme`, `prefers-contrast` or `prefers-reduced-motion` blocks | 1.4.3, 2.3.3 |
| 12 | `public/index.html` `#pad` | Gesture surface has no role, name or keyboard path; unusable with VoiceOver | 2.1.1 (A), 2.5.1 (A), 2.5.7 (AA) |

### Test matrix (must all pass before release)

1. **VoiceOver on iPad 9, Safari standalone** — connect, pick a device, run five deck buttons, add a shortcut with the keyboard picker, delete and restore a button, disconnect. **No step may require touching the trackpad surface.**
2. **VoiceOver + Magic Keyboard / any Bluetooth keyboard** — the same journey using Tab, arrows, Space, Enter and Escape only.
3. **Full Keyboard Access on, VoiceOver off** — every control reachable; focus ring always visible and never under the sticky bar or tab strip.
4. **Dynamic Type at the largest AX size** — deck reflows to list mode (B14.3); no clipping, no overlap, no horizontal page scroll.
5. **Increase Contrast + Reduce Motion + Light mode**, all three on simultaneously.
6. **Automated:** axe-core zero critical/serious; the 44 px target-size script (B1); the Text Spacing bookmarklet (B14.6); a contrast script over the whole tile palette in both themes (B11.5).
7. **Manual keyboard-trap probe:** enter the passthrough field and leave it using only the keyboard (B18.2).

---

## Files that change

| Path | Part | Change |
|---|---|---|
| `/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/host/native/mdinput.swift` | A | Unix-socket client replaces stdin; `setActivationPolicy(.prohibited)`; run loop |
| `/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/host/native/build.sh` | A | Build the `.app`, sign with a stable identity, print the DR, warn on ad-hoc |
| `/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/host/native/MouseNDeckInput.app/Contents/Info.plist` | A | **New** (§A.4.2) |
| `/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/host/native/verify-tcc.sh` | A | **New** (§A.7) |
| `/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/host/input.js` | A | `net.createServer` supervisor; `open -g -n -a`; `responsibleProcess()`; preflight trust check |
| `/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/host/server.js` | A/B | Surface trust state + responsible process in the config message |
| `/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/host/actions.js` | B | Server-side capability gate (B8.8) |
| `~/Library/LaunchAgents/dev.mousendeck.host.plist` | A | **New** (§A.6) |
| `/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/public/index.html` | B | Viewport fix, landmarks, headings, `<dialog>`, tablists, connect/timer/pad markup |
| `/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/public/app.js` | B | Pointer Events, layout grid + roving tabindex, live-region manager, focus management, keyboard/gesture pickers, per-tile contrast |
| `/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/public/style.css` | B | Light theme, all four media queries, focus rings, 44 px targets, reflow breakpoint |
| `/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/public/manifest.webmanifest` | B | `orientation: any`, `lang`, `dir` |
| `/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/README.md` | A | Responsible-process explanation, `⌘Q` step, `tccutil reset` recipe |

---

## Sources

**macOS TCC / responsible process**
- [How to grant command line tools full disk access — Apple Developer Forums (Quinn, DTS)](https://developer.apple.com/forums/thread/756510)
- [On File System Permissions — Apple Developer Forums (Quinn, DTS)](https://developer.apple.com/forums/thread/678819)
- [The Curious Case of the Responsible Process — Qt Blog](https://www.qt.io/blog/the-curious-case-of-the-responsible-process)
- [ghostty#9263 — command launch helper to shed the responsible process bit](https://github.com/ghostty-org/ghostty/issues/9263)
- [AXIsProcessTrustedWithOptions returns false after restart — Apple Developer Forums](https://developer.apple.com/forums/thread/99868)
- [AXIsProcessTrusted returns wrong value in macOS Ventura 13.0+ — Apple Developer Forums](https://developer.apple.com/forums/thread/727984)
- [AssociatedBundleIdentifiers for LaunchAgents/Daemons — Apple Developer Forums](https://developer.apple.com/forums/thread/713493)
- [launchd.plist(5) man page](https://keith.github.io/xcode-man-pages/launchd.plist.5.html)
- [Preserve macOS App Permissions Across Rebuilds with Self-Signed Certificates — Eugene Oleinik](https://evoleinik.com/posts/macos-dev-signing-preserve-permissions/)
- [macOS permissions — OpenClaw docs](https://docs.openclaw.ai/platforms/mac/permissions)
- [macOS TCC — HackTricks](https://hacktricks.wiki/en/macos-hardening/macos-security-and-privilege-escalation/macos-security-protections/macos-tcc/index.html)

**WCAG 2.2**
- [Understanding SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [Understanding SC 2.5.1 Pointer Gestures](https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html)
- [Understanding SC 2.5.2 Pointer Cancellation](https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html)
- [Understanding SC 2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
- [Understanding SC 2.4.11 Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)

**ARIA**
- [WAI-ARIA 1.2 specification](https://www.w3.org/TR/wai-aria-1.2/)
- [ARIA APG — Switch Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/switch/)
- [ARIA APG — Grid Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)
- [MDN — ARIA timer role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/timer_role)

**Apple platform**
- [Apple HIG — Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [iPad (9th generation) Technical Specifications — Apple Support](https://support.apple.com/en-us/111898)
- [WebKit — Using the System Font in Web Content](https://webkit.org/blog/3709/using-the-system-font-in-web-content/)
- [How to support Apple's dynamic type in your web content with CSS — Colin Gourlay](https://dev.to/colingourlay/how-to-support-apple-s-dynamic-text-in-your-web-content-with-css-40c0)
- [Dynamic Type on the Web — furbo.org](https://furbo.org/2024/07/04/dynamic-type-on-the-web/)
- [Direct Touch on iOS — Perkins School for the Blind](https://www.perkins.org/resource/direct-touch-on-ios/)
- [A Complete List of iOS and iPadOS Gestures Available to VoiceOver Users — AppleVis](https://www.applevis.com/guides/complete-list-ios-ipados-gestures-available-voiceover-users)
- [Using the Increased Contrast Mode CSS media query — tempertemper](https://www.tempertemper.net/blog/using-the-increased-contrast-mode-css-media-query)
- [CSS media features to improve accessibility — a11y-blog.dev](https://a11y-blog.dev/en/articles/css-media-features-for-a11y/)