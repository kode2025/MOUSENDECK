# MOUSENDECK

**Turn an iPhone or iPad into a trackpad, a programmable shortcut deck, and an
in-the-air pointer for your Mac — over your own Wi-Fi.**

```bash
connect      # start — prints a QR code. Scan it. That's it.
disconnect   # stop — kills everything, frees the port
```

---

## Why this exists

I built this **purely for fun, and to make my own life easier.**

I kept reaching across the desk for the same handful of things — copy, paste,
screenshot, mute, start the dev server, switch Spaces — and I had an iPad
sitting right there doing nothing. Every existing option wanted an App Store
account, a subscription, or a background daemon that starts at login and never
tells you what it's doing. I wanted none of those.

So this is the version I actually wanted:

- **Nothing runs unless I start it.** No login item, no launch agent, no
  daemon. It exists while a terminal window is holding it, and `disconnect`
  proves the port is free afterwards.
- **No Apple Developer account.** It's a web app you add to your Home Screen.
  Nothing to sign, nothing that expires after 7 days.
- **The permissions are mine.** I start it from my own terminal, so macOS
  attributes every permission prompt to *my* Terminal — not to some tool that
  launched it on my behalf.
- **It has to feel instant.** The software round trip measures **0.65 ms**.
  The rest of what you feel is your touchscreen and your Wi-Fi, and the README
  says so honestly instead of quoting a marketing number.

It's a personal project, it's MIT licensed, and if it's useful to you, take it.

---

## Contents

**Getting started**
1. [What it is](#what-it-is)
2. [Tech stack](#tech-stack)
3. [Requirements](#requirements)
4. [Install](#install)
5. [First run, step by step](#first-run-step-by-step)
6. [The certificate warning](#the-certificate-warning)

**The interface**

7. [Wireframes — every screen](#wireframes--every-screen)
8. [Auto-detection](#auto-detection)
9. [The deck](#the-deck)
10. [The trackpad](#the-trackpad)
11. [The air pointer](#the-air-pointer)
12. [The keyboards](#the-keyboards)
13. [Settings — every control](#settings--every-control)
14. [macOS style and Windows style](#macos-style-and-windows-style)

**Doing things with it**

15. [How to add a shortcut](#how-to-add-a-shortcut)
16. [How to add a shell command](#how-to-add-a-shell-command)
17. [How to add a Terminal command](#how-to-add-a-terminal-command)
18. [Every custom action type](#every-custom-action-type)
19. [Terminal commands on the Mac](#terminal-commands-on-the-mac)

**Under the hood**

20. [Every feature and its user story](#every-feature-and-its-user-story)
21. [Permissions](#permissions)
22. [Background processes and system resources](#background-processes-and-system-resources)
23. [Networking](#networking)
24. [Where your data lives](#where-your-data-lives)
25. [Latency, measured](#latency-measured)
26. [Security](#security)
27. [Protocol and internals](#protocol-and-internals)

**When things go wrong**

28. [Troubleshooting](#troubleshooting)
29. [Crashes and recovery](#crashes-and-recovery)
30. [Honest limitations](#honest-limitations)

**Reference**

31. [Tests and benchmarks](#tests-and-benchmarks)
32. [Project layout](#project-layout)
33. [Contributing](#contributing)

---

## What it is

A small Node server runs on your Mac and serves a web app to your phone or
tablet over the LAN. The phone becomes a precision trackpad, a grid of
programmable buttons, and — if you want it — a gyroscope pointer you aim like a
TV remote. Presses travel back over a WebSocket and are injected as real macOS
input events by a tiny Swift helper.

```
   iPhone / iPad                              Your Mac
┌────────────────────┐                 ┌──────────────────────────────┐
│  public/index.html │                 │  bin/connect                 │
│  public/app.js     │   WebSocket     │    └─ host/server.js         │
│  public/style.css  │◀───────────────▶│         │                    │
│                    │   over TLS      │         ├─ input.js          │
│  · touch gestures  │                 │         │   └─▶ mdinput      │
│  · gyroscope       │   binary for    │         │        (Swift)     │
│  · shortcut board  │   motion,       │         │        └─▶ CGEvent │
│  · on-screen keys  │   JSON for      │         │                    │
│                    │   everything    │         ├─ actions.js        │
│                    │   else          │         │   └─▶ open / zsh / │
│                    │                 │         │       osascript    │
│                    │                 │         ├─ certs.js ─▶openssl│
│                    │                 │         └─ discovery.js      │
│                    │                 │             └─▶ dns-sd       │
└────────────────────┘                 └──────────────────────────────┘
```

Something *has* to run on the Mac. That's not a preference — it was established
the hard way. iOS reserves the Bluetooth HID service UUID `0x1812` for Apple's
own use, so a third-party app cannot present itself as a mouse. And macOS
Screen Sharing accepts a VNC connection and password, then ignores injected
input events. Both routes were built and abandoned; see
[Honest limitations](#honest-limitations).

---

## Tech stack

Deliberately small. No framework, no bundler, no build step for the client, and
two npm dependencies total.

### Languages

| Language | Where | Why |
|---|---|---|
| **JavaScript (ES2022, ESM)** | `host/*.js`, `public/app.js`, `test/*.mjs` | Runs on the Mac and in the browser with no transpiling |
| **Swift 5** | `host/native/mdinput.swift` | The only way to post real system input events on macOS |
| **HTML5 + CSS3** | `public/index.html`, `public/style.css` | No preprocessor — CSS custom properties do the work |
| **Bash** | `bin/connect`, `bin/disconnect`, `host/native/build.sh` | Launchers, so there is nothing to install to start it |

### Runtime and dependencies

| | Version | Purpose |
|---|---|---|
| **Node.js** | ≥ 18 | The host server. ESM, no transpiler |
| [`ws`](https://github.com/websockets/ws) | ^8.18.0 | WebSocket server. Compression disabled for latency |
| [`qrcode-terminal`](https://github.com/gtanner/qrcode-terminal) | ^0.12.0 | Renders the pairing QR in the terminal |
| **swiftc** | Xcode CLT | Compiles the input helper. No SwiftPM, no dependencies |

That is the complete dependency list. `npm install` pulls two packages.

### Node built-ins used

`node:http` · `node:https` · `node:fs` · `node:fs/promises` · `node:path` ·
`node:os` · `node:child_process` · `node:readline` · `node:crypto`

### Browser APIs used

| API | What it does here |
|---|---|
| **WebSocket** | The link to the Mac. Binary frames for motion, JSON for everything else |
| **Touch Events** | The trackpad. `{ passive: false }` so `preventDefault()` works |
| **DeviceMotionEvent** | The air pointer's gyroscope. Requires a secure context (HTTPS) |
| **`DeviceMotionEvent.requestPermission()`** | iOS 13+ motion consent prompt |
| **`ArrayBuffer` / `DataView`** | Preallocated 5-byte motion frames, so no garbage during a gesture |
| **`performance.now()`** | Latency probe timing, monotonic and sub-millisecond |
| **`localStorage`** | Token, interface size, pane state, gyroscope calibration |
| **`navigator.maxTouchPoints`** | Tells an iPad from a MacBook — iPadOS claims to be a Mac |
| **`screen.width` / `screen.height`** | Short-edge test for phone vs tablet |
| **`navigator.wakeLock`** | Stops the screen sleeping mid-session |
| **Page Visibility** | Pauses work when the app is backgrounded |
| **Web App Manifest** | Fullscreen Home Screen icon, no Safari chrome |
| **`structuredClone`** | Board snapshots for Discard changes |

### macOS system APIs (Swift helper)

| Framework | Used for |
|---|---|
| **CoreGraphics / Quartz Event Services** | `CGEventPost`, `CGEventSource`, `CGEvent` — every pointer move, click, scroll and keystroke |
| **ApplicationServices** | `AXIsProcessTrustedWithOptions` — the Accessibility permission check |
| **CoreGraphics display APIs** | `CGGetActiveDisplayList`, `CGDisplayBounds` — multi-monitor bounds |
| **AppKit** | `NSEvent` for media keys (play/pause, volume, brightness); screen-change notifications |
| **Foundation** | JSON decode on the stdin command stream |

### macOS command-line tools invoked

| Tool | Where | For |
|---|---|---|
| `openssl` | `host/certs.js` | Generates the self-signed TLS certificate, once |
| `dns-sd` | `host/discovery.js` | Bonjour advertise and browse |
| `scutil`, `route` | `host/server.js`, `host/config.js` | `.local` name; picking the interface with the default route |
| `open` | `host/actions.js` | Launching apps, URLs, files, and Terminal windows |
| `osascript` | `host/actions.js` | AppleScript buttons only |
| `zsh -lc` | `host/actions.js` | Shell-command buttons |
| `lsof`, `pgrep` | `bin/connect`, `bin/disconnect` | Finding and freeing the port |
| `screencapture`, `pmset`, `shortcuts` | Catalog entries | Screenshots and recording, sleep, Do Not Disturb |

### No services, no accounts, no cloud

There is no backend, no telemetry, no analytics, no crash reporting, no CDN and
no account. Nothing leaves your LAN. The only network traffic is between your
phone and your Mac.

---

## Requirements

| | |
|---|---|
| **Mac** | macOS 12 Monterey or later |
| **Node** | 18 or later — [nodejs.org](https://nodejs.org) |
| **Xcode command line tools** | For `swiftc`. `xcode-select --install` |
| **Phone / tablet** | Any iPhone, iPad or Android device with a modern browser |
| **Network** | Both on the same LAN — home Wi-Fi, or a phone hotspot |

`openssl` ships with macOS; you do not need to install it.

The **host must be a Mac.** The deck can *speak* Windows shortcuts, but there
is no Windows host — see [Honest limitations](#honest-limitations).

---

## Install

```bash
git clone https://github.com/kode2025/MOUSENDECK.git
cd MOUSENDECK
npm install
```

That is the whole install — two packages. The Swift helper compiles
automatically on first run, or build it now:

```bash
npm run build
```

**Optional: put `connect` and `disconnect` on your PATH.** Run this from the
project root and it works wherever you cloned it:

```bash
echo "export PATH=\"$(pwd)/bin:\$PATH\"" >> ~/.zshrc && source ~/.zshrc
```

Without it, use `./bin/connect` and `./bin/disconnect` from the project
directory. Everything else is identical.

---

## First run, step by step

### Step 1 — Grant Accessibility

macOS will not let *any* program move the pointer without it. **The grant goes
to the terminal app you run `connect` from**, not to MouseNDeck.

1. Open **System Settings → Privacy & Security → Accessibility**
2. Click **+**, add **Terminal** (or iTerm, or whichever terminal you use)
3. Make sure its switch is **on**
4. **Quit that app completely** — ⌘Q, not just closing the window
5. Reopen it

Step 4 is not optional. The grant only takes effect on a fresh launch of the
app that holds it.

### Step 2 — Start it

```bash
connect
```

You get something like this:

```
  MOUSENDECK
  ──────────────────────────────────────────────────
  Point your iPad or phone camera at this:

      █▀▀▀▀▀█ ▀▄█▀▄ █▀▀▀▀▀█
      █ ███ █ ▄▀ ▄█ █ ███ █
      █ ▀▀▀ █ █▄▀ █ █ ▀▀▀ █
      ▀▀▀▀▀▀▀ █ ▀ █ ▀▀▀▀▀▀▀
      ... (scan this)

      https://192.168.1.42:8787/?k=8f3c…
      https://Satishs-MacBook.local:8787/?k=8f3c…   ← survives IP changes

  🔒 Secure mode: this certificate is self-signed, because no
     authority will vouch for a LAN address. Your phone will warn
     you once — tap Show Details, then "visit this website".
     This is what unlocks the gyroscope pointer; iOS refuses it
     to any page that is not a secure context.

  Tap Share → "Add to Home Screen" for a fullscreen icon.
  Type  show connected device  here to see who is on.
  Ctrl-C here stops it. Nothing is left running.

  ✓ Accessibility granted — pointer and keys will work.
  ──────────────────────────────────────────────────
```

### Step 3 — Scan the QR

Point your phone or iPad camera at it and tap the link.

**Scanning the QR *is* the connection.** There is no device list and no Connect
button — the page came from exactly one Mac, so there is nothing to choose.

### Step 4 — Get past the certificate warning

Once per device. See [the next section](#the-certificate-warning) for the exact
taps in each browser.

### Step 5 — Choose how you want to use it

The launch chooser appears:

```
 ┌───────────────────────────────────────────────────┐
 │                       🎛                          │
 │            How do you want to use it?             │
 │                                                   │
 │   ┌──────────────────┐  ┌──────────────────┐      │
 │   │        ✥         │  │        ▦         │      │
 │   │     Pointer      │  │ Trackpad & Deck  │      │
 │   │ Aim the phone    │  │ Shortcuts,       │      │
 │   │ like a TV remote.│  │ trackpad and     │      │
 │   │ Held flat,       │  │ keyboard.        │      │
 │   │ screen up.       │  │ Held sideways.   │      │
 │   └──────────────────┘  └──────────────────┘      │
 └───────────────────────────────────────────────────┘
```

It's asked once per launch, because the two modes want the phone held
differently and it's worth settling before you pick it up wrong.

### Step 6 — Add it to your Home Screen (recommended)

**Share → Add to Home Screen**, then launch from the icon. Safari's toolbars
cost about 100 px of height, which is a whole row of buttons on a 10.2" iPad.

Use the **`.local` URL** for this, not the numeric one — it follows your Mac
when its IP changes.

### Step 7 — Stop it when you're done

```bash
disconnect
```

Stops the server, the input helper and the Bonjour advertisement, then confirms
the port is free. Ctrl-C in the `connect` terminal does the same; `disconnect`
is for when it was backgrounded or the terminal was closed on top of it.

---

## The certificate warning

**You will see a security warning the first time you connect from each device.
This is expected and it is safe.** Here is exactly what to tap.

### Why it happens

The server runs over **HTTPS by default**. The certificate is **self-signed**,
because no certificate authority on earth will issue a certificate for
`192.168.1.42` or `Satishs-MacBook.local` — nobody can prove they own a private
address.

Your browser cannot tell "self-signed certificate on your own LAN" from
"someone is intercepting you", so it warns. On your own network, connecting to
your own Mac, it is your certificate and there is nothing between you and it.

**Why bother with HTTPS at all?** iOS only hands `DeviceMotionEvent` — the
gyroscope — to a **secure context**. Over plain `http://` the motion events
never fire at all. No permission, no flag, no developer account changes that.
The air pointer literally cannot exist without HTTPS.

If you don't want the pointer and would rather never see a warning, run
`connect --plain`.

### Safari (iPhone / iPad)

1. The page says **"This Connection Is Not Private"**
2. Tap **Show Details**
3. Tap **visit this website**
4. Tap **Visit Website** in the confirmation

### Chrome (iOS, Android, or desktop)

1. The page says **"Your connection is not private"** — `NET::ERR_CERT_AUTHORITY_INVALID`
2. Click or tap **Advanced** (bottom left)
3. Click or tap **Proceed to 192.168.1.42 (unsafe)**

On Android Chrome the wording is **Advanced → Proceed anyway**.

> If you don't see **Advanced**, click anywhere on the page and type
> `thisisunsafe` — Chrome accepts that as the bypass on pages where the
> interstitial has hidden the button. Nothing appears as you type it.

### Firefox

1. **Warning: Potential Security Risk Ahead**
2. Click **Advanced…**
3. Click **Accept the Risk and Continue**

### Edge

1. **Your connection isn't private**
2. Click **Advanced**
3. Click **Continue to 192.168.1.42 (unsafe)**

### It only happens once

After you accept it, the browser remembers — including from the Home Screen
icon. You will see it again only if you move to a new network and the Mac picks
up an address the certificate doesn't cover, at which point the certificate is
regenerated automatically to include it.

### What is generated, and where

```
certs/key.pem      the private key
certs/cert.pem     the certificate
certs/names.json   which addresses it covers
```

`certs/` is gitignored — it's per-machine. The certificate covers `localhost`,
`127.0.0.1`, your `.local` name and every LAN address the Mac has, and is
issued for **825 days**, the maximum Apple platforms accept for a leaf
certificate.

---

## Wireframes — every screen

### iPad layout — landscape (the full interface)

Board and trackpad side by side. This is the layout on any tablet or larger
screen.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ MouseNDeck    ● Your MacBook   02:44      Finished? Run disconnect   1ms  ⚙ │
├────┬──────────────────────────────────┬────────────────────────────────────┤
│    │  Main ▾                🗑   Edit  │                                    │
│ ▦  │ ┌──────┐┌──────┐┌──────┐┌──────┐ │                                    │
│Deck│ │  ⧉   ││  📋  ││  ↶   ││  ↷   │ │                                    │
│ ▓▓ │ │ Copy ││Paste ││ Undo ││ Redo │ │            TRACKPAD                │
│    │ │  ⌘C  ││  ⌘V  ││  ⌘Z  ││ ⌘⇧Z  │ │                                    │
│ ⬚  │ └──────┘└──────┘└──────┘└──────┘ │      1 drag ─ move · tap ─ click   │
│Pad │ ┌──────┐┌──────┐┌──────┐┌──────┐ │      2 drag ─ scroll · tap ─ right │
│ ▓▓ │ │★ ▶   ││  📸  ││  🔇  ││  🌙  │ │      2 pinch ─ zoom                │
│    │ │ Dev  ││ Shot ││ Mute ││ DND  │ │      2 rest+slide ─ select         │
│ ⌨  │ │ npm  ││ ⌘⇧3  ││  🔇  ││ ⌘F6  │ │      3 swipe ─ spaces · tap ─ mid  │
│Keys│ └──────┘└──────┘└──────┘└──────┘ │      4 swipe ─ desktops            │
│    │                                  │                                 ✥  │
│    │                                  ├────────────────────────────────────┤
│    │                                  │  ⌘   ⌥   ⌃   ⇧      (modifiers)    │
└────┴──────────────────────────────────┴────────────────────────────────────┘
  ↑ pane toggles          ↑ ★ marks a custom button      air pointer ↑
    (lit = showing)
```

### Mobile layout — portrait

A phone runs **portrait**, the way you actually hold a phone, and shows one
pane at a time. The toggles move to a bottom rail.

```
  Deck showing              Pad showing              Keys showing
┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
│ MouseNDeck  ● 1ms⚙│   │ MouseNDeck  ● 1ms⚙│   │ MouseNDeck  ● 1ms⚙│
├───────────────────┤   ├───────────────────┤   ├───────────────────┤
│ Main ▾      Edit  │   │                   │   │ 1 2 3 4 5 6 7 8 9 0│
│┌─────┐┌─────┐     │   │                   │   │ Q W E R T Y U I O P│
││  ⧉  ││ 📋  │     │   │                   │   │  A S D F G H J K L │
││Copy ││Paste│     │   │     TRACKPAD      │   │ ⇧ Z X C V B N M  ⌫ │
││ ⌘C  ││ ⌘V  │     │   │                   │   │#+= ⌃ ⌥ ⌘ space  ⏎  │
│└─────┘└─────┘     │   │  1 drag ─ move    │   │                    │
│┌─────┐┌─────┐     │   │  2 drag ─ scroll  │   │  hold 1.5s to latch│
││ ↶   ││ ↷   │     │   │  2 pinch ─ zoom   │   │  a modifier        │
││Undo ││Redo │     │   │  3 swipe ─ spaces │   │                    │
││ ⌘Z  ││ ⌘⇧Z │     │   │                   │   │                    │
│└─────┘└─────┘     │   │                ✥  │   │                    │
├───────────────────┤   ├───────────────────┤   ├───────────────────┤
│  ▦     ⬚     ⌨   │   │  ▦     ⬚     ⌨   │   │  ▦     ⬚     ⌨    │
│ ▓▓▓                │   │       ▓▓▓         │   │            ▓▓▓     │
└───────────────────┘   └───────────────────┘   └───────────────────┘
```

Turn a phone sideways and you get a prompt to stand it up again — the phone
layout wants the height. The iPad layout is the opposite: it wants landscape.

### Air pointer — its own full-screen UI

Nothing else is on screen. You are aiming at the Mac, not looking at the phone.

```
┌───────────────────────────────┐
│  POINTING                  ⚙  │  ← pointer settings
│  aim the phone · flat,        │
│  port toward you              │
│                               │
│   ┌───────────────────────┐   │
│   │   ✥  Exit pointer     │   │  ← back to where you were
│   └───────────────────────┘   │
│                               │
│                               │
│                               │
│                               │
│ ┌───────┐┌────────┐┌────────┐ │
│ │   ●   ││   ⇕    ││   ◐    │ │
│ │       ││        ││        │ │
│ │ Left  ││ scroll ││ Right  │ │  ← drag the middle lane
│ └───────┘└────────┘└────────┘ │     to scroll
└───────────────────────────────┘
```

### Air pointer — the posture gate

Before pointing starts, you are shown how to hold it, and the app **waits**
until the phone's own gravity reading agrees.

```
┌───────────────────────────────┐
│              📱               │
│     Hold it like a remote     │
│                               │
│      ┌─────────────────┐      │
│      │   ▁▁▁▁▁▁▁▁▁▁▁   │ ↑ away│
│      │  │   screen  │  │      │
│      │  │     up    │  │      │
│      │   ▔▔▔▔▔▔▔▔▔▔▔   │      │
│      │      ═══        │ ↓ port│
│      └─────────────────┘  toward│
│                            you │
│ Lay the phone FLAT on your palm│
│ — screen up, camera down, port │
│ toward you.                    │
│                                │
│ First time? Tap Calibrate.     │
│                                │
│ Then: move the cursor to the   │
│ MIDDLE of your Mac's screen,   │
│ aim at it, and tap Start.      │
│                                │
│ ┌──────┐┌─────────┐┌─────────┐ │
│ │Cancel││Calibrate││  Start  │ │
│ └──────┘└─────────┘└─────────┘ │
└───────────────────────────────┘
```

### The shortcut catalog

```
┌──────────────────────────────────────────────────────┐
│  Add shortcut     ＋ Custom   Discard changes   Save  │
│ ┌──────────────────────────────────────────────────┐ │
│ │ 🔍 Search shortcuts…                             │ │
│ └──────────────────────────────────────────────────┘ │
│  209 shortcuts for macOS · tap to add, tap to remove │
│                                                      │
│  ── Custom shortcuts ──────────────────────────────  │
│  ★ Dev server        npm run dev            ✕     ✓  │
│                                                      │
│  ── Editing ───────────────────────────────────────  │
│    Copy              ⌘C                           ✓  │
│    Paste             ⌘V                           ✓  │
│    Paste and Match   ⌥⇧⌘V                            │
│    Undo              ⌘Z                           ✓  │
│                                                      │
│  ── System ────────────────────────────────────────  │
│    Force Quit    ⚠  ⌥⌘⎋                              │
│    Sleep             pmset sleepnow                  │
│                                                      │
│  ── Screenshots ───────────────────────────────────  │
│    Screenshot        ⌘⇧3                          ✓  │
│    Record area       pick an area                    │
└──────────────────────────────────────────────────────┘
   ✓ = already on this board       ⚠ = destructive
```

### The custom button editor

```
┌──────────────────────────────────────────────────────┐
│  Custom shortcut                              Done   │
│                                                      │
│  Label            ┌──────────────────────────────┐   │
│                   │ Dev server                   │   │
│                   └──────────────────────────────┘   │
│  Icon             ┌──────┐  paste any emoji         │
│                   │  ▶   │  (flaticon.com for more) │
│                   └──────┘                           │
│  Colour           ● ● ● ● ● ● ● ●                    │
│                                                      │
│  Action           ┌──────────────────────────────┐   │
│                   │ Run in Terminal (opens a…) ▾ │   │
│                   └──────────────────────────────┘   │
│  Command          ┌──────────────────────────────┐   │
│                   │ npm run dev                  │   │
│                   └──────────────────────────────┘   │
│  Folder           ┌──────────────────────────────┐   │
│                   │ ~/Projects/my-app            │   │
│                   └──────────────────────────────┘   │
│                                                      │
│              ┌──────┐            ┌────────┐          │
│              │ Test │            │ Delete │          │
│              └──────┘            └────────┘          │
└──────────────────────────────────────────────────────┘
```

### The key picker

Records the **order** you press keys in, with a numbered badge on each.

```
┌──────────────────────────────────────────────────────┐
│  Shortcut          Discard changes    Save shortcut  │
│  Hold a key for half a second to add it              │
│                                                      │
│              ⌘  →  ⇧  →  4                           │
│                                                      │
│  ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐    │
│  │esc││F1││F2││F3││F4││F5││F6││F7││F8││F9││F10││F11│  │
│  └──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘    │
│  ┌──┐┌──┐┌──┐┌──┐┌─❷┐┌──┐┌──┐┌──┐┌──┐┌──┐            │
│  │ 1││ 2││ 3││ 4││ 5││ 6││ 7││ 8││ 9││ 0│            │
│  └──┘└──┘└──┘└─▓┘└──┘└──┘└──┘└──┘└──┘└──┘            │
│  ┌─────┐┌──┐┌──┐┌──┐┌──┐  ┌──────┐                   │
│  │ ⇧ ❷ ││ Z││ X││ C││ V│  │  ⌘ ❶  │                  │
│  └─────┘└──┘└──┘└──┘└──┘  └──────┘                   │
└──────────────────────────────────────────────────────┘
```

### Another device has control

```
┌───────────────────────────────────────────┐
│                    🔒                     │
│             Already in use                │
│   an iPhone is controlling this Mac.      │
│                                           │
│          ┌───────────────────┐            │
│          │    Take over      │            │
│          └───────────────────┘            │
└───────────────────────────────────────────┘
```

One device drives the Mac at a time, and taking over is always explicit — so a
tab someone forgot to close can never lock you out.

### Wrong orientation

```
   iPad layout, held portrait      Phone layout, held landscape
┌────────────────────┐          ┌────────────────────────────────┐
│         ⟳          │          │              📱                │
│  Turn your device  │          │   Hold your phone upright      │
│      sideways      │          │   The phone layout runs in     │
│                    │          │   portrait — the deck, the     │
│  The iPad layout   │          │   trackpad and the keyboard    │
│  needs landscape — │          │   all want the height.         │
│  the trackpad and  │          │                                │
│  board sit side    │          │                                │
│  by side.          │          │                                │
└────────────────────┘          └────────────────────────────────┘
```

Both clear themselves the moment you turn the device.

---

## Auto-detection

**There are no style or layout switches in the interface.** Both are measured,
because a button there could only ever disagree with the truth.

### Which shortcut vocabulary you get — from the host

`host/capabilities.js` reports the OS the server is actually running on, and
the client picks its catalog from that:

| Host reports | Catalog | Entries |
|---|---|---|
| `macos` | macOS | 209 |
| `windows` | Windows | 120 |
| anything else | macOS (fallback) | 209 |

This affects the deck's shortcuts, the on-screen keyboard's layout, the
modifier symbols (⌘⌥⌃⇧ versus Ctrl/Alt/⊞), and which gestures are offered.

### Which layout you get — from the device

Measured freshly on every launch, and again on rotation or resize:

| Device | Layout | How it's decided |
|---|---|---|
| iPhone, iPod, Android phone, Windows Phone | **mobile** | User-agent |
| iPad (any model) | **ipad** | Claims to be a Mac, but `maxTouchPoints > 1` |
| MacBook, Windows laptop, Surface | **ipad** | Short screen edge ≥ 700 px |
| Android tablet | **ipad** | Short screen edge ≥ 700 px |

The awkward case is that **iPadOS deliberately reports itself as a Mac.** It
gives itself away with `navigator.maxTouchPoints`, so an iPad is told from a
MacBook by whether the screen is touchable. A Surface with 10 touch points
still lands on the iPad layout correctly, because it has the width for it.

**Verified across ten device signatures and three host operating systems**, by
test rather than by assertion.

### The catch

Host detection is correct, but **there is no Windows host to detect.** The
entire server side is macOS-only. See
[Honest limitations](#honest-limitations).

---

## The deck

The grid of programmable buttons.

### What every control does

| Control | Where | Does |
|---|---|---|
| **Board name ▾** | Top left of the deck | Opens the board menu: switch, rename, create a new board |
| **🗑** | Beside the board name | Deletes the current board |
| **Edit** | Top right of the deck | Enters edit mode. Becomes **Save changes** once you change something |
| **Discard changes** | Appears in red beside Edit | Rolls the whole editing session back |
| **＋ Add** | In edit mode | Opens the shortcut catalog |
| **✕** on a tile | In edit mode | Removes that button from the board |
| **🔒** on a tile | In edit mode | Built-in — can be moved or removed, not rewritten |
| **★** on a tile | Always | This is a custom button you built |
| **Drag a tile** | In edit mode | Reorder. The others slide out of the way so you can see where it lands |
| **Tap a tile** | Any time | Runs it. Green pulse = ran, **red = failed, with the reason** |

### Editing is transactional

Nothing reaches the Mac until you press **Save changes**. If you've changed
nothing, the button says **Done**. If you have, **Discard changes** appears in
red beside it and rolls everything back to how it was when you entered edit
mode.

If the Wi-Fi drops at the moment you save, you are told **"Saved here — the Mac
is offline, it will sync when it reconnects"**, and it does. You are never told
something saved when it didn't.

### Built-ins are locked, and that's deliberate

A built-in button can be added, removed and rearranged, but not rewritten.
Editing one would silently fork it from the catalog entry it claims to be — you
would have a button labelled "Copy" doing something else. To change one, delete
it and build a custom.

Because they're locked, built-ins **track the catalog**: when an entry is
corrected upstream, boards you saved earlier are updated on the next connect
rather than keeping a button that quietly does the wrong thing.

### The catalog

**209 macOS** and **120 Windows** built-in shortcuts across 13 categories:

`Editing` · `Formatting` · `Text` · `Windows` · `Screenshots` · `Media` ·
`System` · `Finder` · `Go to` · `Apps` · `Browser` · `Code` · `Terminal`

- Search by name, category or key combination
- A green **✓** marks what's already on this board
- Destructive entries carry **⚠** — Force Quit, Quit App, Log Out, Move to
  Trash, Empty Trash
- **Entries are toggles.** Tapping adds, tapping again removes. It cannot
  produce duplicates
- Buttons needing a capability this Mac doesn't have are **never shown**

### Screen capture

| Button | Does |
|---|---|
| **Screenshot** | Whole screen, straight to the desktop |
| **Screenshot area** | Drag out a region |
| **Record screen** | Full-screen recording |
| **Record area** | Drag out a region, then record it |
| **Stop Recording** | Ends it — and says plainly if nothing is running |

These need **Screen & System Audio Recording** permission. See
[Permissions](#permissions).

### Opening applications

The **Apps** category has 11 ready to add:

`Finder` · `Safari` · `Chrome` · `Terminal` · `VS Code` · `Spotify` · `Music` ·
`Mail` · `Notes` · `Slack` · `System Settings`

For anything else, build a custom **Open app, URL or file** button — it takes
any app name, URL, file or folder, and `~` expands properly.

### What's deliberately not included

Apple documents Fn chords for Control Centre (Fn-C), Notification Centre
(Fn-N), the Dock (Fn-A) and Launchpad (Fn-Shift-A). **None of them ship here.**
macOS reads the real Fn key from hardware, and a synthetic `.maskSecondaryFn`
does not reliably reach the WindowServer's hotkey layer. In testing, a non-Fn
chord (⌥⌘D) verifiably flipped `com.apple.dock autohide` 0→1, while Fn-N
produced no signal that survived scrutiny.

Where a shell equivalent exists it's offered instead (`pmset sleepnow`,
`open -a ScreenSaverEngine`), and real Home/End/PageUp/PageDown keycodes are
used rather than the Fn-arrow spellings.

---

## The trackpad

### Every gesture

| Fingers | Gesture | Result |
|---|---|---|
| 1 | drag | move the pointer |
| 1 | tap | left click |
| 1 | double tap | double click |
| 1 | tap, then drag | click and drag |
| 2 | **rest one, slide the other** | click and drag — the selection gesture |
| 2 | drag | scroll |
| 2 | pinch / spread | zoom out / in, continuously, without lifting |
| 2 | tap | right click |
| 3 | swipe ← → | previous / next Space *(Windows: Alt-Tab)* |
| 3 | swipe ↑ | Mission Control *(Windows: Task View)* |
| 3 | swipe ↓ | App Windows *(Windows: Show Desktop)* |
| 3 | tap | middle click |
| 4 | swipe ← → ↑ ↓ | desktop switching |
| 4 | pinch | Launchpad |
| 4 | spread | Show Desktop |

This list is printed on the pad permanently, so the moment you need reminding
is not the moment it has faded out.

### The details that took work

- **Speed-based acceleration**, like a real trackpad: move slowly and the
  cursor is precise, flick and it crosses the screen. There's no pressure
  sensor on an iPad, so speed is what a real trackpad actually varies.
- **Continuous pinch zoom.** It banks the change *since the last step*, not the
  distance from the start, so a long slow pinch keeps zooming instead of firing
  once and stopping.
- **Rest-and-slide** needs per-finger origin tracking. A centroid cannot tell
  "both fingers moved" from "one rested while one slid", and getting that wrong
  means the page flies off before your selection starts.
- **Right click is a two-finger tap** — no on-screen buttons cluttering the pad.

### An honest note on multi-finger gestures

macOS will not let a synthesised event impersonate a real multi-touch gesture:
swipes, pinch and rotate are interpreted by the window server from raw trackpad
data, and `CGEventPost` cannot produce them. So 3- and 4-finger gestures are
delivered as **the keyboard shortcut that produces the same visible result**.

The gesture picker in Settings labels each one `native` or `mapped` so you
always know which you're getting, and never offers one the Mac cannot perform.
Rotate, force click and edge swipes are marked `none` and never offered at all.

---

## The air pointer

Aim the phone at your Mac like a TV remote and the cursor follows.

Tap **✥** on the trackpad, or choose **Pointer** at launch.

### Why it needs HTTPS

iOS delivers `DeviceMotionEvent` only to a **secure context**. On a plain
`http://` page the events never fire — not blocked with an error, simply
absent. That's why the server is HTTPS by default. It has nothing to do with
having a developer account; people assume it does, and it doesn't.

### How to hold it

**Flat on your open palm.** Screen facing up, back camera facing down, charging
port toward you, camera edge pointing away.

- **tilt the far edge up and down** → cursor moves up and down
- **swivel left and right** → cursor moves across

On an **iPad** you are asked to stand the device upright first, because it has
to come out of the landscape you were just using it in. On a **phone** that
step is skipped — the phone layout is already portrait, so asking would be a
screen that exists only to be dismissed.

The app shows a diagram, then **waits** — it reads the phone's own gravity
vector and doesn't continue until you're actually holding it that way. An
orientation media query cannot tell "flat" from "upright", so gravity is what
it uses.

### Calibration, and why it exists

Which sensor channel carries "tilt" and which carries "swivel" is **not
consistent across devices**. Guessing wrong sends the cursor left when you tilt
up — which is exactly what happened, twice, before this was built.

So it measures instead. Two prompts, about five seconds:

1. **Tilt the far edge UP** and hold until it closes
2. **Swivel the far edge RIGHT** and hold until it closes

It records which axis moved and in which direction, saves the answer for that
device, and never asks again. **Recalibrate** in the pointer settings redoes it
if you change phones or something feels wrong.

### Aiming

Before you tap **Start pointing**: move your Mac's cursor to the **middle of
the screen**, and aim the phone at that spot.

Aiming and the cursor line up from wherever they both happen to be at that
moment, so starting from the centre leaves you room to move in every direction.

### The pointer screen

| Control | Does |
|---|---|
| **✥ Exit pointer** | Stops pointing and returns you to the exact pane you left |
| **● Left** | Left click |
| **⇕ scroll** (middle) | Drag up and down to scroll — aiming can't scroll, so this is how |
| **◐ Right** | Right click |
| **⚙** | Pointer settings |

There's deliberately nothing else on screen. You're aiming at the Mac, not
looking at the phone, and a HUD you can't look at is not a HUD.

### Pointer settings

Only what has an effect while pointing:

| Setting | Range | Does |
|---|---|---|
| **Pointer speed** | 5–60 | How far the cursor travels per degree of tilt |
| **Invert vertically** | on/off | For if tilting up should send the cursor down |
| **Scroll speed** | 0.2–4 | How fast the middle lane scrolls |
| **Natural scrolling** | on/off | Content follows your finger, or the reverse |
| **Recalibrate** | — | Redo the two-motion axis measurement |

Trackpad speed, acceleration and board columns are *not* here — they'd be four
sliders whose effect you cannot feel from this screen. Both settings sheets
write to the same stored values, so they can never disagree.

---

## The keyboards

A full keyboard for the **connected computer**, not your phone's. It never
raises the iOS keyboard, because that would type into the web page rather than
into the Mac.

### On an iPad — the full desktop layout

Opens as a sheet. Every key shows its shortcut. macOS or Windows layout,
matching the detected host.

### On a phone — a purpose-built layout

A scaled-down desktop keyboard on a 6-inch screen is unusable, so the phone
gets its own:

```
┌─────────────────────────────────────┐
│  1  2  3  4  5  6  7  8  9  0       │  ← numbers always visible
│  Q  W  E  R  T  Y  U  I  O  P       │
│   A  S  D  F  G  H  J  K  L         │
│  ⇧  Z  X  C  V  B  N  M       ⌫     │
│ #+=  ⌃   ⌥   ⌘    space      ⏎      │
└─────────────────────────────────────┘

  tap #+= for:
┌─────────────────────────────────────┐
│  -  =  [  ]  \  ;  '  `  /  ,       │
│  .  esc ⇥  ⌦  ⇞  ⇟  ⤒  ⤓            │
│  ⇧  ↑  ↓  ←  →                ⌫     │
│ ABC  ⌃   ⌥   ⌘    space      ⏎      │
└─────────────────────────────────────┘
```

- **Numbers are always on the top row**, not hidden behind a layer
- **`#+=`** swaps in punctuation plus escape, tab, arrows, page up/down,
  home/end
- **Modifiers latch on a 1.5-second hold**, not a tap. The key fills as you
  hold it so you can see progress; a quick tap tells you to hold instead of
  doing nothing

Why hold and not tap? A deck's keyboard is used mostly for chords, and a
tap-to-latch modifier fires constantly by accident — you brush ⌘ reaching for
something else and the next letter becomes a command.

---

## Settings — every control

The **⚙** in the header.

| Setting | Range | What it does |
|---|---|---|
| **Interface size** | 50–150%, 5% steps | Scales the deck, trackpad and keyboard. **−** and **＋** step by 5%; **Fit** brings the whole board back on screen |
| **Pointer speed** | 0.4–5 | How far the cursor travels for the same finger movement on the trackpad |
| **Acceleration** | 0–4 | How much a *fast* swipe is amplified over a slow one. At 0 the speed is constant |
| **Air pointer speed** | 5–60 | How far the cursor travels per degree of tilt |
| **Invert air pointer vertically** | on/off | Flips the air pointer's vertical axis |
| **Scroll speed** | 0.2–4 | How far two-finger scrolling moves the page |
| **Board columns** | 3–6 | Fewer means larger buttons; more fits more on screen |
| **Natural scrolling** | on/off | Content follows your fingers, or the reverse |
| **Tap to click** | on/off | Whether a tap counts as a click |
| **Left-handed** | on/off | Puts the trackpad on the left, deck on the right |
| **Trackpad gesture picker** | — | Shows every gesture, labelled `native` or `mapped` |

### What is stored where

Most settings live **on the Mac** in `config.json`, so every device sees the
same ones and they survive a restart.

Four things live **on the device**, because they describe the screen in your
hand rather than the setup:

| On the device | localStorage key | Why |
|---|---|---|
| Interface size | `mnd.zoom.<layout>` | An iPad and a phone want very different sizes — stored separately per layout |
| Which panes are showing | `mnd.show` | Where you left off |
| Air pointer calibration | `mnd.aircal` | Measured from *this* phone's sensors |
| Access token | `mnd.token` | So a Home Screen icon reconnects without rescanning |

---

## macOS style and Windows style

The deck speaks one vocabulary at a time, chosen automatically from the host.

|  | macOS style | Windows style |
|---|---|---|
| **Entries** | 209 | 120 |
| **Modifiers** | ⌘ ⌥ ⌃ ⇧ | Ctrl · Alt · ⊞ · Shift |
| **Copy** | ⌘C | Ctrl+C |
| **Screenshot** | ⌘⇧3 · ⌘⇧4 | ⊞+PrtScn · ⊞+Shift+S |
| **Switch app** | ⌘Tab | Alt+Tab |
| **Spaces / desktops** | ⌃← ⌃→ | ⊞+Ctrl+← / → |
| **Mission Control / Task View** | ⌃↑ | ⊞+Tab |
| **Show Desktop** | F11 | ⊞+D |
| **Lock** | ⌃⌘Q | ⊞+L |
| **Files** | Finder | File Explorer `⊞+E` |
| **Categories** | 13 | 11 |
| **Keyboard layout** | macOS | Windows |
| **3-finger swipe ←→** | Previous / Next Space | Alt-Tab |

Switching happens by itself when you connect to a different machine. There is
no toggle, because the deck should never claim to speak a language the machine
on the other end doesn't.

**Note:** Windows style is a *vocabulary*, not a supported host. See
[Honest limitations](#honest-limitations).

---

## How to add a shortcut

A worked example: adding **Screenshot area** (⌘⇧4) to your board.

1. **Tap `Edit`** at the top right of the deck.
   The button becomes highlighted and each tile grows a ✕ badge.
2. **Tap `＋ Add`.**
   The catalog opens with all 209 macOS shortcuts.
3. **Search or scroll.**
   Type `screen` in the search box, or scroll to the **Screenshots** category.
4. **Tap `Screenshot area`.**
   A green ✓ appears next to it — it's now on your board.
   *Tapping it again would take it off. Entries are toggles, so you can never
   end up with two.*
5. **Tap `Save changes`** at the top of the catalog.
   The catalog closes, the board saves, and you see **"Board saved"**.

To remove one: **Edit → ✕** on the tile → **Save changes**. Or reopen the
catalog and tap the entry again to untoggle it.

To rearrange: **Edit →** drag a tile. The others slide out of the way so you
can see where it will land before you let go. Then **Save changes**.

---

## How to add a shell command

A worked example: a button that empties the Downloads folder's `.dmg` files.

1. **Tap `Edit` → `＋ Add` → `＋ Custom`.**
2. **Label** — type `Clear DMGs`.
3. **Icon** — paste any emoji. `🧹` works. (The editor links to
   [flaticon.com](https://www.flaticon.com) if you want something specific.)
4. **Colour** — tap a swatch.
5. **Action** — choose **`Shell command (no window)`** from the dropdown.
6. **Command** — type it:
   ```
   rm -f ~/Downloads/*.dmg
   ```
7. **Tap `Test`.** It runs right now, on the Mac. If it fails you're told why,
   immediately, rather than finding out later from a tile that went red.
8. **Tap `Done`**, then **`Save changes`**.

The button appears on your board with a **★** in the corner marking it as
yours, and a caption showing the command rather than a key combination.

### What "shell command" means exactly

- It runs through **`zsh -lc`**, so your `~/.zshrc` is loaded and your PATH,
  aliases and functions are available
- It runs **detached** — there's no window and you see no output
- If it **fails**, the tile turns red and the error reaches your device
- If it's **long-running** (a server, a watch process), that counts as started
  successfully, not as failed
- It's saved to your **custom library**, so you can drop it on any board

**Use this for fire-and-forget things.** If you want to see output, use a
Terminal command instead.

---

## How to add a Terminal command

This is the one for **running your projects.** It opens a real Terminal window
you can read and Ctrl-C.

A worked example: a button that starts your dev server.

1. **Tap `Edit` → `＋ Add` → `＋ Custom`.**
2. **Label** — `Dev server`.
3. **Icon** — `▶`.
4. **Action** — choose **`Run in Terminal (opens a window)`**.
5. **Command**:
   ```
   npm run dev
   ```
6. **Folder** (optional):
   ```
   ~/Projects/my-app
   ```
   `~` expands properly. If the folder doesn't exist you're told so, by name.
7. **`Test`** → a Terminal window opens and runs it.
8. **`Done`** → **`Save changes`**.

### How it works, and why it works that way

It writes a small `.command` script into a temp folder and opens it with
`open -a Terminal`. You get a real window, with real output, that you can read
and interrupt.

There's a second reason it's built this way: **`open` needs no Automation
permission**, whereas telling Terminal what to do via AppleScript does. So this
button asks you for nothing.

Housekeeping is handled: old scripts are swept automatically, and pressing the
same button twice reuses the same filename rather than littering your temp
folder.

### A page of buttons that run your projects

Make a new board for it — **tap the board name ▾ → New board**, call it
`Projects` — and fill it with Terminal buttons:

| Label | Command | Folder |
|---|---|---|
| `Dev server` | `npm run dev` | `~/Projects/my-app` |
| `Tests` | `npm test` | `~/Projects/my-app` |
| `API` | `python manage.py runserver` | `~/Projects/api` |
| `Logs` | `tail -f /var/log/system.log` | |
| `Pull all` | `git pull` | `~/Projects/my-app` |

Then switch to that board whenever you sit down to work.

---

## Every custom action type

**＋ Custom** in the catalog. Only the types this host can actually perform are
offered.

| Type | Fields | Does |
|---|---|---|
| **Keyboard shortcut** | key combination | Any combination, built with the on-screen key picker |
| **Media / volume key** | which key | Play/pause, next, previous, volume up/down, mute, brightness up/down |
| **Open app, URL or file** | target | Anything `open` accepts: an app name, a URL, a file, a folder. `~` expands |
| **Shell command (no window)** | command | Runs detached via `zsh -lc`. Silent unless it fails |
| **Run in Terminal (opens a window)** | command, folder | Writes a `.command` and opens it — you watch it run |
| **AppleScript** | script | Runs via `osascript`. Needs Automation permission |
| **Type text** | string | Types it on the Mac, character by character |
| **Mouse click** | button, count | Left, right or middle; single or double |

### Building a key combination

The key picker records the **order** you press keys in, with a numbered badge
on each — so `⌘` then `⇧` then `4` is stored as ⌘⇧4, in that order.

**Hold a key for half a second to add it.** The fill animation shows progress.
**Save shortcut** commits it, **Discard changes** reverts.

### The custom library

Custom shortcuts are saved to a **library**, not just to the board you made
them on. Once you have any, a **Custom shortcuts** section appears at the top
of the catalog so you can drop them onto any board.

The **✕** on a library entry forgets it. Buttons already placed on a board
stay.

---

## Terminal commands on the Mac

`connect` holds the terminal open, so that terminal is where you ask it things.
Type a line and press return:

```
show connected device
```

```
  Connected devices (2)
  ────────────────────────────────────────────────────
  ▶ an iPad     192.168.1.7   in control   for 12:04
    an iPhone   192.168.1.9   watching     for 3:11
```

`▶` is the device actually driving the Mac; anything else is connected but
ignored until it takes over.

| Type this | And it | Also accepts |
|---|---|---|
| `show connected device` | Lists what's connected and which is driving | `who`, `devices`, `connected`, `status`, `show` |
| `url` | Prints the link again | `link` |
| `qr` | Prints the QR code again — useful after switching networks | `code` |
| `address` | Re-checks where this Mac is. Warns if it no longer matches the QR | `addresses`, `ip` |
| `accessibility` | Re-checks whether input is permitted, without restarting | `access` |
| `help` | Lists these | `?` |
| `quit` | Stops the server, same as Ctrl-C | `exit`, `stop`, `disconnect`, `q` |

These exist only while `connect` is running. Backgrounding it is fine — stdin
closing isn't treated as an error, the server just carries on serving without a
console.

---

## Every feature and its user story

Every story below is implemented and verified. These are the actual
requirements this was built against, roughly in the order they arrived.

### Core

| # | As someone using this, I want… | How it works |
|---|---|---|
| 1 | to use my phone or iPad as a mouse for my Mac | Web app served over the LAN; input injected via `CGEventPost` |
| 2 | to program buttons for my most-used actions | 329-entry catalog plus a custom button editor |
| 3 | the lowest latency possible | Binary pointer protocol, Nagle off, compression off. Measured: [0.65 ms](#latency-measured) |
| 4 | it to work without a paid developer account | PWA added to the Home Screen; no signing, no 7-day expiry |
| 5 | **nothing** running on my Mac unless I start it | No login item, no agent. `disconnect` proves the port is free |
| 6 | to connect by scanning a QR, with no device picker | The page comes from exactly one Mac, so there's nothing to choose |
| 7 | the trackpad and shortcuts on one screen | iPad layout puts the board and pad side by side |
| 8 | **permissions to belong to my project, not a tool that launched it** | You start it from your own terminal, so macOS attributes every prompt there — and it warns you on startup if it wasn't |

### The deck

| # | As someone using this, I want… | How it works |
|---|---|---|
| 9 | to add a shortcut without building it by hand | Searchable catalog, filtered to what this Mac can actually do |
| 10 | to never be offered a button that can't work | Entries declare a capability; unsupported ones are hidden |
| 11 | to remove shortcuts, including pre-added ones | Any button can be deleted; built-ins are re-addable from the catalog |
| 12 | to add and remove from the catalog without duplicates | Catalog entries are **toggles** — tap adds, tap again removes |
| 13 | to save my board for next time, in the project folder | `board.json`, readable and committable |
| 14 | several boards and a way to switch between them | Board menu under the board name — switch, rename, create, delete |
| 15 | to save or discard a batch of edits | **Done** when clean; **Save changes** + **Discard changes** when not |
| 16 | to rearrange buttons and see where one will land | Drag to reorder, with FLIP animation on the surrounding tiles |
| 17 | to tell my own buttons from the presets | **★** in the tile's top-left corner, shown all the time |
| 18 | to edit only the buttons I made | Built-ins are locked; editing one would silently fork it from the entry it claims to be |
| 19 | to know when a button didn't work | Tile turns red and the device is told why |
| 20 | **never to be told something saved when it didn't** | Saves that miss a dropped socket are held and replayed, and the message says which happened |
| 21 | **a page of buttons that run my projects** | The Terminal action writes a `.command` and opens it — a real window you can read |
| 22 | one-tap screen capture | Full screenshot, area screenshot, full recording, area recording, and a stop button |
| 23 | to open my applications | 11 built-in app buttons, plus a custom Open action for anything else |

### Input and interface

| # | As someone using this, I want… | How it works |
|---|---|---|
| 24 | a real trackpad's gestures, not a cut-down set | 1/2/3/4-finger gestures, [all listed](#every-gesture) |
| 25 | to zoom continuously without lifting my fingers | Pinch banks distance since the last step, not since the start |
| 26 | to select text by resting one finger and sliding another | Per-finger origin tracking distinguishes it from a scroll |
| 27 | a full keyboard for the *Mac*, not my phone's keyboard | On-screen keyboard in the connected platform's layout |
| 28 | every key to show its shortcut | Shortcut printed on each key |
| 29 | everything to fit on screen without scrolling | Exact row counts; keyboard rows share the remaining height |
| 30 | to make the interface bigger or smaller | 5% steps, 50–150%, per device and per layout, plus **Fit** |
| 31 | **the same header everywhere** | One header for every combination of style and layout |
| 32 | to see the connection and how long it's been up | Live latency readout and session timer in the header |
| 33 | to show the deck and keep it shown until I say otherwise | Deck and Pad are independent toggles, not tabs |
| 34 | the keyboard to come back to where I was | Keys is an overlay; leaving it restores exactly what it covered |
| 35 | to see which panes are showing | The pressed toggles light up |
| 36 | **a better phone keyboard, with the numbers visible** | Purpose-built phone layout: numbers row, QWERTY, `#+=` layer |
| 37 | **to hold, not tap, for a modifier** | 1.5-second press-and-hold latches ⌘ ⌥ ⌃ ⇧, with the key filling as it goes |
| 38 | **to use my phone in portrait** | The phone layout is a portrait design; landscape gets the prompt instead |

### The air pointer

| # | As someone using this, I want… | How it works |
|---|---|---|
| 39 | **to point at the screen with my phone**, without a developer account | `DeviceMotionEvent` over HTTPS. iOS needs a *secure context*, not a paid account |
| 40 | **to tap once, not hold** | Latched. Tap ✥ to start, **Exit pointer** to stop |
| 41 | to be told exactly how to hold it | Flat on the palm, screen up, port toward you — with a diagram, and a gate that waits for gravity to agree |
| 42 | the axes to be right on *my* phone | Two-step calibration measures which sensor carries which motion. Remembered per device |
| 43 | **no other HUD while pointing** | Pointer mode is a separate full-screen UI |
| 44 | left and right click side by side, exit above them | Exactly that |
| 45 | **to scroll while pointing** | A scroll lane between the two clicks, where a mouse puts its wheel |
| 46 | to be asked which mode when I launch | A launch chooser: Pointer, or Trackpad & Deck |
| 47 | to be put back where I was on exit | One screen, not two: it returns to the pane you were on |
| 48 | to be prompted to turn the phone the right way, both directions | Upright before pointing, back to your layout's orientation after — and never on a phone already in portrait |
| 49 | **pointer settings on the pointer screen** | Its own sheet, with only what does something while pointing |

### Host and safety

| # | As someone using this, I want… | How it works |
|---|---|---|
| 50 | only one device controlling the Mac at a time | Exclusive holder, with an explicit **Take over** |
| 51 | **to see which device is connected, from the terminal** | Type `show connected device` where `connect` is running |
| 52 | it to keep working when I change networks | Address watcher reprints the QR; `.local` URL survives IP changes |
| 53 | it to work on my phone's hotspot | It does — the phone is the network |
| 54 | nothing exposed beyond my own LAN | Token auth, LAN-only origin policy, no internet exposure |
| 55 | **HTTPS without having to remember a flag** | It's the default. `connect --plain` opts out |
| 56 | **the layout and shortcut style detected, not chosen** | Platform from the host, layout from the device. No switches |
| 57 | it to stop completely when I say so | `disconnect` kills the server, helper and Bonjour, then proves the port is free |

### Asked for, and not possible

| # | Story | Why not |
|---|---|---|
| 58 | Force Touch / pressure sensitivity | The iPad 9 has no pressure sensor. Speed-based acceleration is what a real trackpad actually varies |
| 59 | Sub-5 ms *perceived* latency | 60 Hz touch sampling is a 16.7 ms floor in hardware. The software round trip is 0.65 ms; perceived lag can't beat one frame |
| 60 | Running the host on Windows | The input helper is Swift and `CGEventPost`; the launcher is bash. The Windows *catalog* exists, the Windows *host* doesn't |
| 61 | Real 3- and 4-finger gestures | macOS won't let a synthetic event impersonate multi-touch. They're delivered as the equivalent shortcut, and labelled as such |
| 62 | Bluetooth — no Mac software at all | iOS reserves the HID service UUID `0x1812`. A third-party app cannot be a mouse |

---

## Permissions

Three separate grants, three separate prompts. A missing one fails differently.
**All are granted to the app running the server — your terminal — not to
MouseNDeck.**

| Permission | Needed for | Where | If missing |
|---|---|---|---|
| **Accessibility** | The pointer, clicks, and every key shortcut | Privacy & Security → Accessibility | Nothing moves at all. The banner says so at startup |
| **Screen & System Audio Recording** | The Screenshot and Record buttons | Privacy & Security → Screen & System Audio Recording | Recording reports that it's blocked |
| **Automation** | Only buttons that drive another app via AppleScript | Privacy & Security → Automation | That button reports "macOS is blocking control of …" |

**Accessibility is the only one needed** for the trackpad and the vast majority
of shortcuts. The other two are prompted for the first time you press a button
that needs them.

### How to grant them

1. **System Settings → Privacy & Security → *the permission***
2. Click **+** and add **Terminal** (or iTerm, or your terminal of choice)
3. Turn its switch **on**
4. **⌘Q that terminal app completely** and reopen it
5. Run `connect` again

Step 4 matters every time. macOS only picks up a new grant on a fresh launch.

### Start it yourself, from your own terminal

**This matters more than it looks.**

macOS records a **responsible process** when a program is launched, and every
permission prompt is attributed to *that* app — not to this script.

- Start it from **your Terminal** → the prompts say **Terminal**, and the
  grants stick to it.
- Start it from **something else** (an editor's task runner, a build script, a
  launcher) → the prompts name *that tool* instead. Worse, granting them does
  nothing for a later run from a real terminal, because the responsible process
  is different. You end up with a permission you appear to have granted and an
  app that still can't record the screen.

If it detects it wasn't started from a terminal, it tells you:

```
⚠  Not started from a terminal.
   macOS will attribute permission prompts to whatever launched
   this, not to your Terminal — so a screen-recording prompt may
   name the wrong app, and granting it will not help next time.
   For permissions to belong to you, run it yourself:
       connect
```

This is also why the **Run in Terminal** action uses `open -a Terminal` on a
`.command` file rather than scripting Terminal via AppleScript: `open` needs no
Automation permission at all, so that button asks you for nothing.

### What it never asks for

No Full Disk Access. No Contacts, Calendar, Photos, Microphone or Camera. No
Location. No admin password. No keychain access. Nothing installs to `/usr/`,
nothing writes outside the project folder and the system temp directory.

---

## Background processes and system resources

### What actually runs

While `connect` is running, exactly three processes exist:

| Process | What it is | Started by | CPU at rest |
|---|---|---|---|
| `node host/server.js` | The HTTPS + WebSocket server | `bin/connect`, in the foreground | ~0% |
| `host/native/mdinput` | The Swift input helper | `host/input.js`, as a child | ~0% |
| `dns-sd -R …` | The Bonjour advertisement | `host/discovery.js` | ~0% |

All three are children of the terminal you started. Close it, or press Ctrl-C,
or run `disconnect`, and all three are gone.

### What does not run

- **No launch agent.** Nothing in `~/Library/LaunchAgents`
- **No login item.** Nothing in System Settings → General → Login Items
- **No daemon, no menu-bar app, no helper that reinstalls itself**
- **Nothing starts at boot.** If you didn't type `connect`, it isn't running

You can verify at any time:

```bash
pgrep -fl "host/server.js|mdinput|_mousendeck"
```

Silence means nothing is running.

### What it uses while you're using it

| Resource | Typical | Notes |
|---|---|---|
| **CPU (node)** | 1–3% during active motion, ~0% idle | One core, and only while a finger is moving |
| **CPU (mdinput)** | < 1% | A `CGEventPost` costs ~125 µs; at 60 Hz that's 0.75% of one core |
| **Memory (node)** | ~45 MB RSS | Two dependencies, no framework |
| **Memory (mdinput)** | ~8 MB RSS | No dependencies at all |
| **Network** | ~3 KB/s during motion, ~50 B/s idle | 5-byte motion frames; a 100 ms keep-alive that stands down during gestures |
| **Disk** | Nothing while running | `board.json` on save; `certs/` once |
| **Battery (phone)** | Comparable to a web page | The gyroscope costs more; the pointer is not a background mode |

### What it touches on your Mac

| Path | When | What |
|---|---|---|
| `./config.json` | On first run and on settings changes | Token, machine identity, preferences |
| `./board.json` | When you save a board | Your buttons |
| `./certs/` | On first run, and when your addresses change | Self-signed TLS key and certificate |
| `$TMPDIR/mousendeck/` | When you press a Terminal button | `.command` scripts, swept automatically |
| **Nothing else** | — | No system files, no other user data |

### The one thing that persists

`config.json`, `board.json` and `certs/` stay in the project folder after you
stop. Delete the folder and nothing of MouseNDeck remains on the machine —
there's nothing installed anywhere else to clean up.

---

## Networking

### Do both devices need the same Wi-Fi?

They need the same *network*. Wi-Fi is the usual way, not the only one:

| Setup | Works? | Notes |
|---|---|---|
| Both on the same Wi-Fi | ✅ | The normal case |
| **Mac tethered to the iPhone's Personal Hotspot** | ✅ | The phone *is* the network, and can control the Mac at the same time. Addresses look like `172.20.10.x` |
| iPhone joined to a hotspot the Mac is sharing | ✅ | Same thing, other way round |
| iPad on Wi-Fi, Mac on Ethernet, same router | ✅ | Same network, different cable |
| Guest Wi-Fi with client isolation | ❌ | The network deliberately blocks device-to-device traffic |
| Different networks, or over the internet | ❌ | By design — nothing is exposed beyond your LAN |

The server notices when you're on a hotspot and says so in the banner.

### The address problem, and what's done about it

The URL contains your Mac's IP, and that changes whenever the network does.
Switching between Wi-Fi and a hotspot is enough. A Home Screen icon saved
against the old address just spins forever — the page never loads, so none of
the app's own code ever runs to tell you why.

Three things address this:

1. The server **watches for the address changing** and reprints the QR
   unprompted, warning that any code you already scanned is stale
2. `address` re-checks on demand and says if it no longer matches the QR
3. The banner offers a **`.local` URL** alongside the numeric one. Use that for
   Add to Home Screen — it follows the Mac across networks

The address the QR uses is chosen from the interface carrying the **default
route**, not the first one the OS happens to list. VPN, AirDrop, bridge and
virtual-machine interfaces (`utun`, `awdl`, `llw`, `bridge`, `vmnet`, `vnic`,
`ipsec`, `gif`, `stf`, `anpi`) are skipped — they have addresses, and none of
them are reachable from your phone.

### Ports

| Port | Protocol | Purpose |
|---|---|---|
| `8787` (default) | HTTPS + WSS | Everything. Change with `PORT=9000 connect` |
| `5353` | mDNS/UDP | Bonjour, via the system's own `dns-sd` |

Nothing needs to be opened on your router. Nothing should be.

---

## Where your data lives

| File | Contents | Safe to commit? |
|---|---|---|
| `board.json` | Your boards, buttons and custom shortcut library | ✅ yes |
| `config.json` | Access token, machine identity, preferences | ❌ gitignored |
| `certs/` | Self-signed TLS key and certificate | ❌ gitignored |

`board.json` is readable JSON you can edit by hand, copy between machines, or
commit:

```json
{
  "columns": 5,
  "pages": [
    {
      "name": "Main",
      "buttons": [
        {
          "id": "a1b2c3",
          "label": "Copy",
          "icon": "⧉",
          "color": "#3b82f6",
          "action": { "type": "key", "key": "c", "mods": ["cmd"] },
          "builtin": "edit.copy"
        },
        {
          "id": "d4e5f6",
          "label": "Dev server",
          "icon": "▶",
          "color": "#22c55e",
          "action": {
            "type": "terminal",
            "cmd": "npm run dev",
            "dir": "~/Projects/my-app",
            "title": "Dev server"
          }
        }
      ]
    }
  ],
  "customs": []
}
```

The split is deliberate: your buttons are worth sharing, your access token is
not. `config.json` is generated on first run.

---

## Latency, measured

Real numbers, reproducible on your own machine with `npm run bench`.

### What the software costs

Round trip through the real server, on loopback, using the same op-6 probe the
header readout uses:

|  | median | p95 | worst |
|---|---|---|---|
| `ws://` — `connect --plain` | **0.54 ms** | 2.12 ms | 76.8 ms |
| `wss://` — `connect` (default) | **0.65 ms** | 2.99 ms | 68.9 ms |

**TLS costs 0.11 ms.** HTTPS is effectively free, which is why it's the
default.

Inside the input helper, per event:

| Step | Cost |
|---|---|
| Decode a command from stdin | 3.5 µs |
| Read the real cursor position | 0.1 µs |
| **`CGEventPost` — actually moving the cursor** | **125 µs** |

### Where your 15–25 ms actually goes

If your iPad shows 20 ms and the software costs 0.65 ms, the other 19 ms is not
in this repo. It is:

| Term | Cost | Can it be reduced? |
|---|---|---|
| **Touch digitiser sampling** | **16.7 ms** on a 60 Hz iPad | **No.** This is hardware. A 120 Hz iPad Pro halves it to 8.3 ms |
| **Wi-Fi round trip** | 2–10 ms typical | Somewhat — see below |
| **Wi-Fi radio wake from power-save** | +20–40 ms, occasionally | Mitigated with a keep-alive |
| **Everything in this project** | **0.65 ms** | Already done |

This is why the honest ceiling is one frame, not 5 ms. A 60 Hz touchscreen
cannot tell you about a movement more often than every 16.7 ms, no matter what
happens afterwards.

### What was done to make it fast

- **Nagle's algorithm off** (`setNoDelay`) on both the HTTP connection and the
  upgraded socket — it would otherwise hold small packets up to 40 ms waiting
  to coalesce them
- **WebSocket compression off** — pure overhead on a 5-byte frame
- **Motion is binary, not JSON** — no parse step in the hot path
- **Preallocated buffers**, one per opcode, so no garbage is produced while a
  finger is moving and the GC never stutters mid-gesture
- **Burst coalescing in the input helper.** When several moves are already
  queued, their deltas are summed and posted as *one* `CGEvent` instead of
  several. Deltas are additive so the cursor lands in exactly the same place —
  it just gets there in one 125 µs post instead of N of them. It only ever
  merges what is *already* waiting, so it can never add latency
- **A short backpressure window (256 bytes).** It used to be 4096, which is
  eight hundred queued moves — when a stall cleared, the cursor spent seconds
  flying through where your finger used to be. Past 256 bytes the deltas merge
  in the client instead
- **The keep-alive stands down during gestures.** A 100 ms probe keeps the iOS
  Wi-Fi radio out of power-save, but mid-swipe the radio is already awake and
  the ping is just a frame in front of the one that matters
- **The helper re-anchors to the real cursor only when idle.** Syncing every
  packet compounds macOS's own pointer acceleration and a fast swipe travels
  twice as far as it should

### How to reduce latency yourself

In rough order of how much they help:

1. **Use 5 GHz Wi-Fi, not 2.4 GHz.** The single biggest thing you control.
   2.4 GHz is crowded and its retry behaviour is what produces the >30 ms
   spikes.
2. **Get closer to the router**, or move the router. Signal strength drives
   retransmissions, and retransmissions are the spikes.
3. **Add it to your Home Screen and launch from the icon.** Safari's own
   chrome costs both height and a little compositing work.
4. **Turn Low Power Mode off** on the phone. It makes the Wi-Fi radio
   sleepier, which is exactly what the keep-alive is fighting.
5. **Use `connect --plain`** if you don't need the air pointer. It saves
   0.11 ms — genuinely marginal, listed only for completeness.
6. **Close other MouseNDeck tabs.** Only one device drives the Mac, but extra
   connections still get keep-alive traffic.
7. **Don't route through a VPN.** If your Mac's default route is a tunnel, the
   traffic may leave the LAN and come back. `address` shows which interface is
   in use.
8. **A 120 Hz device halves the floor.** An iPad Pro or a recent iPhone samples
   touch at 120 Hz — 8.3 ms instead of 16.7 ms. Nothing in software competes
   with that.

### Reading the header

The header shows a live round-trip figure and the best seen:

- **Green** under 15 ms
- **Amber** under 40 ms
- **Red** above that

If the number is good but it *feels* laggy, the problem is the touch frame or
the display, not the link. If the number is bad, it's the Wi-Fi.

---

## Security

- The server binds your LAN only and is **never** exposed to the internet
- Every connection needs the **token** from the QR / URL
- **HTTPS by default**, so nothing on the LAN can read your keystrokes off the
  wire
- WebSockets are exempt from CORS, so the origin check is explicit: localhost,
  `.local`, and RFC1918 private ranges are allowed; anything else is refused —
  which is what stops a malicious web page or DNS rebinding reaching in
- The token is never sent back to the client and never written to `board.json`
- Path traversal is blocked; every request is contained inside `public/`
- One device holds control at a time, and taking it over is explicit
- No telemetry, no analytics, no crash reporting, no accounts, no cloud

### Be aware of what this is

**Anyone who has the token can move your pointer, press keys, and run shell
commands on your Mac.** That's the whole point of it, and it's also the risk.

- Treat the URL like a password
- Don't run it on a network you don't trust — a café, a hotel, a shared office
- Stop it when you're done. `disconnect` is one word
- `config.json` is gitignored for this reason. Don't commit it

---

## Protocol and internals

### Binary hot path

Pointer traffic uses fixed-width opcodes, not JSON:

| Op | Payload | Meaning |
|---|---|---|
| 1 | `i16 dx, i16 dy` | move |
| 2 | `i16 dx, i16 dy` | scroll |
| 3 | `u8 button` | button down |
| 4 | `u8 button` | button up |
| 5 | `u8 button, u8 count` | click |
| 6 | `u32 timestamp` | latency probe, echoed back verbatim |

All little-endian. Buttons: `0` left, `1` right, `2` middle.

The probe carries *its own* timestamp rather than timing against a shared
variable, because on a slow link two probes are always in flight at once and a
single variable silently mis-measures them.

### JSON control messages

Everything that isn't motion, where clarity is worth more than microseconds.

**Device → host**

| `t` | Carries | Does |
|---|---|---|
| `takeover` | — | Claim exclusive control |
| `key` | `key`, `mods[]` | Press a combination |
| `text` | `s` | Type a string |
| `press` | `id` | Run the board button with this id |
| `action` | `action` | Run an ad-hoc action (the editor's **Test**) |
| `setboard` | `board` | Save the board |
| `setprefs` | `prefs` | Save a subset of preferences |
| `setpointer` | `pointer` | Save pointer settings |
| `rescan` | — | Re-browse Bonjour |

**Host → device**

| `t` | Carries | Means |
|---|---|---|
| `hello` | `capabilities`, `config`, `identity`, `peers` | Everything the client needs on connect |
| `granted` | — | You now hold control |
| `released` | `by` | Someone else took control |
| `failed` | `id`, `label`, `error` | That button did not work, and why |
| `peers` | `list` | Other hosts seen on the LAN |

`setboard`, `setprefs` and `setpointer` are the *durable* messages: if the
socket is down they're held and replayed on reconnect, last-writer-wins per
kind, with `setprefs` merged rather than clobbered. That's what makes "Board
saved" a claim rather than a hope.

### Host → helper

Newline-delimited JSON on stdin:

```
{"t":"move","dx":7,"dy":-3}
{"t":"click","b":"left","n":2}
{"t":"key","key":"c","mods":["cmd"]}
```

The helper reads with its own buffered line reader rather than `readLine()`,
specifically so it can answer *"is another line already waiting?"* — which is
what makes burst coalescing possible.

### Input injection

`host/native/mdinput.swift` posts `CGEvent`s at the `.cghidEventTap` level, the
lowest-latency tap available. It's a separate process on purpose: it's the only
binary that needs Accessibility permission, it has zero dependencies, and if it
dies `host/input.js` restarts it with exponential backoff without taking the
server down.

### Actions

Everything that isn't raw input — launching apps, shell commands, AppleScript,
opening a Terminal window — is `host/actions.js`, and every action returns
`{ ok: true }` or `{ ok: false, error }`.

Shell processes are watched on **`close`**, not `exit`. `exit` fires as soon as
the process ends and can beat the last chunk of piped stderr — losing the very
message being reported.

---

## Troubleshooting

**`zsh: command not found: connect`**
The PATH line hasn't been picked up. Run `source ~/.zshrc`, open a new tab, or
use `./bin/connect` from the project folder.

**`zsh: no matches found: https://…?k=…`**
zsh treats the `?` as a glob. Quote the URL: `open "https://…"`.

**Safari/Chrome says the connection is not private**
Expected, once per device. See
[The certificate warning](#the-certificate-warning) for the exact taps.

**The pointer doesn't move**
Accessibility isn't granted to the terminal you launched from. Add it, then
**fully quit** that app (⌘Q) and rerun. The startup banner tells you which
state you're in; typing `accessibility` re-checks live without restarting.

**Endless loading / a spinner that never resolves**
Almost always a stale address. Type `address` in the `connect` terminal to see
where the Mac actually is, then `qr` for a fresh code. Put the **`.local`** URL
on your Home Screen to stop it recurring.

**The air pointer button does nothing**
The page isn't a secure context. You're on `http` — either you ran
`connect --plain`, or you opened an old bookmark. Reconnect over `https`.

**The cursor goes the wrong way when I tilt**
Tap **⚙ → Recalibrate**. The sensor-to-motion mapping differs between phones
and is measured, not assumed.

**"Turn your device sideways" on a phone**
The phone layout is portrait. Stand it up. (The iPad layout is the opposite: it
wants landscape.)

**Three- or four-finger swipes do nothing**
Put three fingers on the pad and watch the counter in its top-left corner. It
shows how many touches the *page* is receiving, which is not always how many
are on the glass.

- **It says 3 and turns blue** — the gesture arrived. If nothing happens on the
  Mac, check System Settings → Keyboard → **Keyboard Shortcuts…** →
  **Mission Control**, and make sure **Move left a space** / **Move right a
  space** are ticked. They are commonly off. You also need more than one
  desktop for there to be anywhere to go.
- **It stays on 1 or 2** — your device is keeping the extra touches. iPadOS
  claims three- and four-finger swipes system-wide for Undo/Redo and the App
  Switcher, and a web page is never told about them. Nothing in this project
  can override that; `preventDefault()` and `touch-action: none` both sit
  below the system gesture layer. Use the **Space ←** and **Space →** buttons
  from the Windows category of the catalog instead — same shortcut, one tap,
  and nothing can intercept it.

**A button does nothing**
It shouldn't be possible for a button to fail silently — the tile goes red and
says why. "macOS is blocking…" means a permission, which has to be granted at
the Mac.

**Screen recording is blocked**
Grant Screen & System Audio Recording to your terminal, ⌘Q it, and relaunch. If
the prompt named some *other* app, you didn't start the server from a terminal
— see [Permissions](#permissions).

**Do Not Disturb says it needs setup**
Apple removed scriptable Focus control in macOS 12. Open the **Shortcuts** app,
create a shortcut named exactly **`Toggle DND`** with the **Set Focus** action
set to Do Not Disturb / Toggle, and save. The button tells you this in the app
rather than failing silently.

**Port 8787 is busy**
`disconnect`. Or use another port: `PORT=9000 connect` (and
`PORT=9000 disconnect`).

**It says another device is in control and I'm the only one**
A tab you forgot about, or a phone in your pocket. Tap **Take over** — that's
exactly what it's for.

**The board is empty after reconnecting**
Check `board.json` exists in the project folder. If you moved or re-cloned the
project, the board lives with it.

---

## Crashes and recovery

Nothing here can leave your Mac in a bad state, but here's what happens and
what to do.

### The input helper crashes

`host/input.js` notices and restarts it automatically, with exponential backoff
so a persistently broken binary can't spin your CPU. You'll see:

```
[mdinput] exited (SIGSEGV); restarting in 1000ms
```

The server keeps running and your connection stays up. If it keeps crashing,
rebuild it:

```bash
npm run build
```

### The server crashes or the terminal is closed

The helper and the Bonjour advertisement are its children and go with it. Your
phone shows **"Connection lost — reconnecting…"** and retries with backoff. Run
`connect` again and it reconnects on its own — you don't need to rescan.

**Your board is safe.** It's on disk in `board.json`, saved when you pressed
Save changes.

### The Wi-Fi drops mid-edit

Edits you hadn't saved are still on the device. Press **Save changes** as
normal — if the socket is down you're told **"Saved here — the Mac is offline,
it will sync when it reconnects"**, and it does, automatically, the moment the
socket comes back. You'll see **"Saved to the Mac"** when it lands.

### Something is stuck and I want it all gone

```bash
disconnect
```

Stops the server, the helper and Bonjour, then **proves** the port is free:

```
  MouseNDeck — shutting down
  ──────────────────────────
    stopping server (34064)
    stopping input helper (34065)
    stopping Bonjour advertisement (34066)

  ✓ Stopped. Port 8787 is free and nothing is left running.
```

If something still holds the port it names the process and its pid rather than
claiming success.

### Verify by hand that nothing is running

```bash
pgrep -fl "host/server.js|mdinput|_mousendeck"
```

Silence means nothing is running.

### The cursor is stuck or a modifier is held down

A latched modifier lives in the *helper*, so restarting it clears everything:

```bash
disconnect && connect
```

Physically pressing and releasing the key on your Mac's own keyboard also
clears it.

### A shell button ran something I regret

Shell buttons run detached, so they aren't stopped by `disconnect`. Find and
stop it the normal way:

```bash
pgrep -fl "the-command-you-ran"
```

**This is why the ⚠ marker exists** on destructive catalog entries, and why the
editor has a **Test** button — so you find out what a command does while you're
looking at it.

### Total reset

```bash
disconnect
rm -f config.json          # new token, new identity, keeps your board
rm -rf certs/              # new certificate — devices warn once more
npm run build              # rebuild the helper
connect
```

To remove it entirely, delete the folder. Nothing is installed anywhere else.

---

## Honest limitations

**Something must run on the Mac.** Two alternatives were built and abandoned:

- **Bluetooth HID.** iOS reserves the HID service UUID `0x1812`; a third-party
  app cannot advertise itself as a mouse or keyboard. No developer account
  would change this — it's a platform restriction, not a licensing one.
- **VNC / Screen Sharing.** macOS accepts the connection and the password, then
  ignores injected input events. Proven with a clean-room client: connection
  established, password accepted, cursor did not move.

**Windows is a vocabulary, not a host.** The Windows catalog exists so the deck
can *speak* Windows. There is no Windows host — the input helper is Swift and
`CGEventPost`, the launcher is bash, and the actions use `open`, `osascript`
and `pmset`. Running `connect` on a Windows machine will not work today. The
client and the catalog are already waiting for one; see
[Contributing](#contributing).

**Multi-finger gestures are keyboard shortcuts.** macOS cannot synthesise real
trackpad gestures. The UI never offers a gesture the Mac can't perform, and
labels each `native` or `mapped`.

**Force Touch is impossible.** No pressure sensor on the iPad 9.

**The certificate warning can't be removed** without installing a CA profile on
your phone, which is a bigger imposition than one warning screen.

**Do Not Disturb needs a one-time setup.** Apple removed scriptable Focus
control in macOS 12. The only supported route is a Shortcuts shortcut named
`Toggle DND`; the button tells you exactly what to create.

**The air pointer is aim-relative, not absolute.** It has no idea where your
Mac's screen is in the room. It maps rotation to cursor movement, which is why
you're asked to line them up at the centre before starting.

**Perceived latency can't beat one touch frame.** 16.7 ms on a 60 Hz iPad. The
software is 0.65 ms of that; the rest is physics.

---

## Tests and benchmarks

Two suites need nothing running:

```bash
npm test
```

- `test/console.mjs` — starts its own server on a spare port, connects two
  devices, and drives the terminal console the way a person would
- `test/persistence.mjs` — proves a save is never *claimed* unless it happened,
  by lifting the durable-save code straight out of `public/app.js`

```bash
npm run bench
```

- `test/latency.mjs` — starts a real server in both schemes and times the real
  latency probe. Prints the table in [Latency, measured](#latency-measured)

Two suites drive a **live Mac**, so start a server first with `connect`:

```bash
TOKEN=$(node -e "console.log(require('./config.json').token)") npm run test:protocol
```

```bash
TOKEN=$(node -e "console.log(require('./config.json').token)") npm run test:actions
```

`test:actions` is the important one. It checks that failures are *reported*
rather than swallowed — a tile that pulses green while nothing happened on the
Mac is the worst failure mode this project has, because it sends you looking
for the problem on the wrong machine.

Both detect the scheme automatically, wait for the server to confirm they hold
control before firing anything, and say plainly what to do if something else
took over mid-run.

To press a single button from the command line, without picking up the iPad:

```bash
node test/press.mjs Finder
```

---

## Project layout

```
bin/connect              start the server, print the QR (HTTPS by default)
bin/disconnect           stop everything, prove the port is free

host/server.js           HTTPS + WebSocket, QR banner, origin policy,
                         exclusive control, terminal console, address watcher
host/certs.js            self-signed certificate, reissued when addresses change
host/input.js            owns the Swift helper, restarts it if it dies
host/actions.js          runs deck actions, reports success or failure honestly
host/config.js           config.json + board.json
host/capabilities.js     what this host actually is and can do, plus the
                         honest native/mapped/none gesture list
host/discovery.js        Bonjour advertise and browse
host/native/mdinput.swift  posts real input via CGEventPost; coalesces bursts
host/native/build.sh     compiles it with swiftc

public/index.html        the app shell — every screen, present from the start
public/app.js            gestures, air pointer, board, editor, keyboards, panes
public/catalog.js        209 macOS + 120 Windows built-in shortcuts
public/style.css         design tokens, both layouts, the pointer UI
public/manifest.webmanifest   Home Screen icon and standalone display
public/icons/            app icons

test/console.mjs         terminal-console tests (starts its own server)
test/persistence.mjs     a save is never claimed unless it happened
test/latency.mjs         measured round trip, both schemes
test/protocol.mjs        end-to-end protocol tests (needs a live server)
test/actions.mjs         every button reports success or failure honestly
test/press.mjs           hand tool: press one board button from the CLI

docs/TASKS.md            work log
docs/research/           background research: accessibility and TCC, discovery
                         and pairing, the iPad layout, the Windows catalog
```

Every source file opens with a comment explaining what it's for and, where it
matters, why it's built the way it is rather than the obvious way.

---

## Contributing

Issues and pull requests welcome. Two things worth knowing first:

- **The honesty rule.** Nothing may claim to have worked when it didn't. If you
  add an action, it must return a result, and a failure must reach the device
  that asked for it.
- **Never offer what can't work.** Capabilities are declared by the host and
  filtered on the client. A button that cannot possibly succeed on this machine
  should not be visible on it.

**The most useful thing anyone could add is a Windows host** — a `SendInput`
helper to replace `mdinput.swift`, a launcher to replace `bin/connect`, and
Windows equivalents in `host/actions.js`. The client, the catalog and the
capability negotiation are already waiting for it.

---

## Licence

MIT — see [LICENSE](LICENSE). Built for fun. Do what you like with it.
