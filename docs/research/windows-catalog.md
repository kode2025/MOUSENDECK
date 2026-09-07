# Windows Target Support — Capability Catalog & Host Feasibility

All four deliverables are written and machine-validated. **Files (absolute paths):**

| File | Contents |
|---|---|
| `public/catalog.js` (Windows half) | 99-entry Windows shortcut catalog, 10 categories |
| `…/scratchpad/win/gestures.json` | 25-gesture OS-neutral taxonomy with per-OS resolution |
| `…/scratchpad/win/capability.schema.json` | JSON Schema draft 2020-12 (validated) |
| `…/scratchpad/win/capability.windows.example.json` | Worked Windows 11 23H2 example (validates) |
| `…/scratchpad/win/capability.macos.example.json` | Worked macOS 15 example (validates) |

**Verification I ran:** all 99 catalog entries pass the capability filter against the Windows doc (0 rejected); the same catalog run against the macOS doc is correctly rejected 46/99 (40 on the `win` modifier, 5 on keys `win`/`printscreen`/`apps`, 1 on media key `stop`). Gesture ids resolve with zero unresolved/undeclared on both sides.

---

## 1. Windows host input injection

### 1.1 The API surface that mirrors `mdinput.swift`

`SendInput(UINT cInputs, LPINPUT pInputs, int cbSize)` is the single entry point — it replaces every `CGEventPost` call. It serialises events into the input stream so they can't be interleaved with real user input mid-chord.

```c
typedef struct tagINPUT {
  DWORD type;                 // INPUT_MOUSE=0, INPUT_KEYBOARD=1, INPUT_HARDWARE=2
  union { MOUSEINPUT mi; KEYBDINPUT ki; HARDWAREINPUT hi; };
} INPUT;

typedef struct tagMOUSEINPUT {
  LONG dx; LONG dy; DWORD mouseData; DWORD dwFlags; DWORD time; ULONG_PTR dwExtraInfo;
} MOUSEINPUT;

typedef struct tagKEYBDINPUT {
  WORD wVk; WORD wScan; DWORD dwFlags; DWORD time; ULONG_PTR dwExtraInfo;
} KEYBDINPUT;
```

**Struct sizes matter — `cbSize` must match exactly or the call fails silently.** On x64: `MOUSEINPUT`=32, `KEYBDINPUT`=24, `INPUT`=**40** (4-byte `type` + 4 padding + 32 union). On x86: `INPUT`=28. This is the single most common bug in hand-rolled FFI bindings.

**`MOUSEEVENTF_*` flags**

| Flag | Value | Use |
|---|---|---|
| `MOVE` | 0x0001 | movement occurred |
| `LEFTDOWN` / `LEFTUP` | 0x0002 / 0x0004 | op3 / op4 |
| `RIGHTDOWN` / `RIGHTUP` | 0x0008 / 0x0010 | |
| `MIDDLEDOWN` / `MIDDLEUP` | 0x0020 / 0x0040 | |
| `XDOWN` / `XUP` | 0x0080 / 0x0100 | `mouseData` = XBUTTON1 (1) / XBUTTON2 (2) |
| `WHEEL` | 0x0800 | `mouseData` = delta, + is away from user |
| `HWHEEL` | 0x1000 | `mouseData` = delta, + is right |
| `MOVE_NOCOALESCE` | 0x2000 | stops the system merging `WM_MOUSEMOVE` |
| `VIRTUALDESK` | 0x4000 | absolute coords span the whole virtual desktop |
| `ABSOLUTE` | 0x8000 | `dx`/`dy` are 0–65535 normalised |

`WHEEL_DELTA` = **120** = one notch. Gotcha: `mouseData` is declared `DWORD` (unsigned), so negative deltas must be written as two's-complement (`(DWORD)(int32_t)-120`); several binding generators get this wrong.

**`KEYEVENTF_*` flags:** `EXTENDEDKEY` 0x0001, `KEYUP` 0x0002, `UNICODE` 0x0004, `SCANCODE` 0x0008.

### 1.2 Absolute vs relative — use absolute, and this is load-bearing for latency/feel

The docs are explicit that relative motion is **rescaled by the user's pointer-speed slider and the two mouse-threshold values, and can be multiplied by up to 4×**. That means identical trackpad deltas produce different cursor travel on different machines, and it stacks on top of your own `sensitivity`/`acceleration` in `config.json` — you'd be accelerating an already-accelerated signal, non-deterministically.

**Do exactly what `mdinput.swift` already does:** keep the cursor position in the agent, re-sync from the OS before each gesture, apply your own curve, and emit absolute moves.

```
GetCursorPos(&pt)                              // == syncCursor() / CGEvent(source:nil).location
pt.x += dx; pt.y += dy                         // your own accel curve, already in app.js
vx = (pt.x - SM_XVIRTUALSCREEN) * 65535 / (SM_CXVIRTUALSCREEN - 1)
vy = (pt.y - SM_YVIRTUALSCREEN) * 65535 / (SM_CYVIRTUALSCREEN - 1)
SendInput(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, vx, vy)
```

Without `VIRTUALDESK` the 0–65535 space maps to the **primary monitor only** — multi-monitor breaks. `SM_XVIRTUALSCREEN`/`SM_CXVIRTUALSCREEN` (via `GetSystemMetrics`) are the direct analogue of the `desktopBounds()` display-union in the Swift injector. Call `SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)` at startup, or on a mixed-DPI setup the virtual-screen metrics come back in scaled coordinates and the cursor lands off-target. This is also where a `displays` re-read hooks in, mirroring `didChangeScreenParametersNotification` (Windows equivalent: `WM_DISPLAYCHANGE`).

The rounding to a 65535 grid costs ~0.04 px on a 2560-wide display — invisible. Sub-pixel remainders are already accumulated client-side in `app.js` (`accX`/`accY`), so nothing is lost.

### 1.3 Virtual keys vs scan codes

Send by **VK** by default (`wVk` = code, `wScan` = 0). VK is layout-dependent, which is what you want for a shortcut deck: `ctrl+c` should hit the C keycap wherever it is on the user's layout.

Send by **scan code** (`KEYEVENTF_SCANCODE`, `wScan` = `MapVirtualKey(vk, MAPVK_VK_TO_VSC)`, `wVk` ignored) as an opt-in fallback: DirectInput/RawInput games read scan codes and ignore VK-only injection entirely. The capability doc exposes this as `actions.key.scanCodeFallback`.

`KEYEVENTF_EXTENDEDKEY` is required for the E0-prefixed keys when sending by scan code: arrows, Insert/Delete/Home/End/PageUp/PageDown, Num Lock, Print Screen, right Ctrl/Alt, numpad Enter and divide, and both Windows keys.

Key VK codes for this project:

| Name | VK | | Name | VK |
|---|---|---|---|---|
| ctrl / shift / alt | 0x11 / 0x10 / 0x12 | | `win` (left) | `VK_LWIN` 0x5B |
| A–Z | 0x41–0x5A (ASCII) | | 0–9 | 0x30–0x39 |
| tab / return / escape / space | 0x09 / 0x0D / 0x1B / 0x20 | | backspace / delete | 0x08 / 0x2E |
| left/up/right/down | 0x25/0x26/0x27/0x28 | | F1–F24 | 0x70–0x87 |
| printscreen | `VK_SNAPSHOT` 0x2C | | apps (menu) | `VK_APPS` 0x5D |
| `-` `=` `,` `.` | OEM_MINUS 0xBD, OEM_PLUS 0xBB, OEM_COMMA 0xBC, OEM_PERIOD 0xBE | | `;` `/` `` ` `` `[` `\` `]` `'` | OEM_1 0xBA, OEM_2 0xBF, OEM_3 0xC0, OEM_4 0xDB, OEM_5 0xDC, OEM_6 0xDD, OEM_7 0xDE |

**Media keys are dramatically simpler than on macOS.** No `NSEvent` `systemDefined` subtype-8 hack — they are ordinary VKs: `VK_MEDIA_PLAY_PAUSE` 0xB3, `VK_MEDIA_NEXT_TRACK` 0xB0, `VK_MEDIA_PREV_TRACK` 0xB1, `VK_MEDIA_STOP` 0xB2, `VK_VOLUME_MUTE` 0xAD, `VK_VOLUME_DOWN` 0xAE, `VK_VOLUME_UP` 0xAF. The whole `pressMedia` special case collapses into the normal key path.

**Brightness is a genuine capability gap.** There is no brightness VK. macOS has `brightnessup`/`brightnessdown`/`illuminationup`/`illuminationdown`; Windows has none — it needs WMI (`WmiMonitorBrightnessMethods`) and only works on internal panels. The capability doc encodes this and the iPad will hide those buttons on a Windows target.

### 1.4 Unicode text

`KEYEVENTF_UNICODE` with `wVk = 0` and `wScan` = the **UTF-16 code unit**. The system synthesises a `VK_PACKET` keystroke; `TranslateMessage` turns it into `WM_CHAR`. It may only be combined with `KEYEVENTF_KEYUP`.

Two consequences: (a) send a down/up pair per code unit; (b) **non-BMP characters (emoji) must be sent as two separate INPUTs — high surrogate then low surrogate.** Naively truncating a code point to 16 bits silently drops emoji. The `beyondBMP` capability flag exists for injectors that don't handle this. Batch the whole string into one `SendInput` array rather than one call per character — this is the analogue of the 16-char chunking and `usleep(1500)` in the Swift version, and on Windows the batching makes the sleep unnecessary.

### 1.5 UIPI / UAC limits — must be surfaced in the UI

> "This function is subject to UIPI. Applications are permitted to inject input only into applications that are at an equal or lesser integrity level."
> "This function fails when it is blocked by UIPI. Note that neither GetLastError nor the return value will indicate the failure was caused by UIPI blocking."

That second sentence is the important one: **there is no way to detect a UIPI drop.** You cannot retry, log, or warn reactively. The only correct design is to state the limitation up front, which is why `injector.permission.integrity` is in the capability doc.

Practical consequences for an unelevated agent (integrity `medium`):
- Elevated windows (admin terminal, Task Manager on most systems, regedit-as-admin) ignore all injected input. Opening them works; driving them does not.
- The **UAC consent dialog runs on a separate secure desktop** — `SendInput` from the normal desktop never reaches it regardless of elevation.
- **Ctrl+Alt+Del (the Secure Attention Sequence) cannot be synthesised by any user-mode process, ever.** Don't put it in the catalog. `Win+L` does work.
- The agent must run **in the interactive user session**, not as a session-0 Windows service. Ship it as a Startup-folder / Task Scheduler "at logon, current user" item.

Offer "run as administrator" as an explicit opt-in that raises the agent to `high` integrity and unblocks elevated windows. Default to unelevated; the capability doc's `warnings[]` already carries the `uipi.unelevated` message for the connect sheet.

One more from the docs: *"This function does not reset the keyboard's current state."* If the user is physically holding Shift, your injected chord is polluted. Add a pre-flight `GetAsyncKeyState` sweep over the four modifiers and release any that are stuck — `mdinput.swift` doesn't need this because `CGEvent.flags` is set explicitly, but on Windows modifiers are real key-down state.

The nice surprise: **no permission prompt at all.** There is no Accessibility-grant equivalent, so Windows onboarding is strictly simpler than macOS.

### 1.6 Language recommendation: **Go**

Weighed against your three priorities — no heavy runtime install, easy to build, low latency — and against the constraint that **your dev machine is a Mac**:

| Option | Runtime on target | Build from macOS | Latency | Verdict |
|---|---|---|---|---|
| **Go** | none (static exe ~2 MB) | `GOOS=windows GOARCH=amd64 go build`, no cgo, no cross-toolchain | `syscall.SyscallN` → user32, ~sub-µs | **Recommended** |
| Rust | none (~300 KB) | needs `x86_64-pc-windows-gnu` + mingw-w64 from brew | best-in-class | Strong runner-up |
| C# / .NET 8 Native AOT | none | ✗ **blocker** — Native AOT cannot cross-compile; needs a Windows box + MSVC linker | excellent | Rejected on build constraint |
| C# / .NET Framework 4.8 | **in-box on Win 11** (4.8.1 since 22H2) | compile *on the target* with in-box `csc.exe` | fine after JIT warm-up | **Best fallback** |
| Python + ctypes | ✗ needs a Python install (the in-box `python` is a Store stub) | trivial | ~1–2 µs, 50–100 ms startup | Prototyping only |
| PowerShell + `Add-Type` | none | trivial | ~1–3 s cold compile | Bootstrap only |

**Why Go wins.** Cross-compilation is a single command with zero extra toolchain — that preserves your existing workflow, where the Mac builds everything (`host/native/build.sh` already does this for Swift). It produces one static `.exe` with nothing to install on the Windows box, so there's no .NET/Python dependency to explain to a user. `syscall.SyscallN` into `user32.dll` is direct FFI with no marshalling layer, and with a **preallocated `[N]INPUT` array reused across calls there is zero allocation on the pointer hot path** — the same zero-garbage discipline the client already follows with its preallocated `bMove`/`bScroll` DataViews. Go's GC then never runs mid-gesture. Rust is marginally faster and smaller but adds mingw-w64 build friction for a difference that is invisible next to the transport.

**Latency framing:** the `SendInput` syscall itself is single-digit microseconds. Against a Wi-Fi RTT in the low milliseconds, injector choice is ~0.1% of end-to-end lag — so optimise the transport, and pick the injector language for build and deployment ergonomics. That is exactly what Go maximises. (These are order-of-magnitude expectations, not measurements; worth instrumenting the Windows agent the same way the Mac path is, so the numbers on screen stay real.)

**Keep the process model identical.** Same newline-delimited-JSON-on-stdin protocol, same command verbs (`move`/`moveto`/`down`/`up`/`click`/`scroll`/`key`/`text`/`media`/`displays`/`ping`), same `--check` handshake — on Windows `--check` reports the integrity level instead of AX trust. `host/input.js` then needs only a platform switch on the binary path, and `host/server.js` needs no change at all.

One deployment note: SmartScreen will warn on an unsigned downloaded `.exe`. Either build it locally, strip the mark-of-the-web, or fall back to the `csc.exe` on-target compile path, which sidesteps the warning entirely because nothing was downloaded.

**`actions.js` needs a Windows sibling**, since `open`/`shell`/`applescript` are macOS-shaped: `open -a X` → `start`/`ShellExecute`; `/bin/zsh -lc` → `powershell.exe -NoProfile -Command`; `osascript` → `powershell`. The capability model expresses this as `shell.dialects` / `script.dialects` rather than a hardcoded type, so the iPad's editor can label the field correctly per target.

---

## 2. Windows shortcut catalog — 99 entries

Same shape as your existing `config.json` buttons (`{id,label,icon,color,action}`), same colour palette, modifier vocabulary `ctrl` / `shift` / `alt` / `win`.

Distribution: system 21, nav 16, window 16, edit 15, media 7, files 6, apps 6, capture 5, desktops 4, text 3. Action types: 86 `key`, 7 `media`, 6 `open`.

**Edit** — Copy `ctrl+c` · Paste `ctrl+v` · Cut `ctrl+x` · Undo `ctrl+z` · Redo `ctrl+y` · Select All `ctrl+a` · Save `ctrl+s` · Save As `ctrl+shift+s` · Print `ctrl+p` · Find `ctrl+f` · Replace `ctrl+h` · Paste Plain `ctrl+shift+v` · Bold `ctrl+b` · Italic `ctrl+i` · Underline `ctrl+u`

**Text & Clipboard** — Clipboard `win+v` · Emoji `win+.` · Voice Type `win+h`

**Navigation** — Back `alt+←` · Forward `alt+→` · Up `alt+↑` · Refresh `f5` · Hard Refresh `ctrl+shift+r` · Address Bar `alt+d` · New Tab `ctrl+t` · Close Tab `ctrl+w` · Reopen Tab `ctrl+shift+t` · Next/Prev Tab `ctrl+tab` / `ctrl+shift+tab` · Zoom In/Out/Reset `ctrl+=` / `ctrl+-` / `ctrl+0` · New Window `ctrl+n` · Private Win `ctrl+shift+n`

**Windows** — Snap Layouts `win+z` · Snap Left/Right `win+←/→` · Maximize `win+↑` · Minimize `win+↓` · Move ◀/▶ Display `win+shift+←/→` · Task View `win+tab` · Show Desktop `win+d` · Minimize All `win+m` · Restore All `win+shift+m` · Peek `win+,` · Switch App `alt+tab` · Switch Back `alt+shift+tab` · App Switcher `ctrl+alt+tab` · Close Window `alt+f4`

**Virtual Desktops** — New `win+ctrl+d` · Next `win+ctrl+→` · Prev `win+ctrl+←` · Close `win+ctrl+f4`

**System** — Settings `win+i` · File Explorer `win+e` · Lock `win+l` · Run `win+r` · Quick Link `win+x` · Task Manager `ctrl+shift+esc` · Quick Settings `win+a` · Notifications `win+n` · Widgets `win+w` · Search `win+s` · Start `win` · Copilot `win+c` · Project `win+p` · Cast `win+k` · Game Bar `win+g` · Magnify ± `win+=` / `win+-` · Magnify Off `win+esc` · Narrator `win+ctrl+enter` · Wake Display `win+ctrl+shift+b` · Accessibility `win+u`

**Capture** — Snip Region `win+shift+s` · Screenshot `win+printscreen` · Print Screen `printscreen` · Window Shot `alt+printscreen` · Record `win+alt+r`

**Files** — New Folder `ctrl+shift+n` · Rename `f2` · Delete `delete` · Delete Forever `shift+delete` *(flagged `destructive:true`)* · Properties `alt+enter` · Context Menu `apps`

**Media** *(`type:"media"`)* — Play `playpause` · Next · Prev · Stop · Mute · Vol + `soundup` · Vol − `sounddown`

**Apps** *(`type:"open"`)* — Explorer `explorer.exe` · Terminal `wt.exe` · Notepad · Calculator · Settings `ms-settings:` · Browser `microsoft-edge:`

Entries carry optional `minOS` (Snap Layouts and Copilot are gated to `10.0.22000` / `10.0.22621`) and `notes` for context-dependent chords — e.g. `ctrl+shift+n` is New Folder in Explorer but InPrivate in a browser, and Win+V requires clipboard history to be enabled once in Settings.

---

## 3. Windows Precision Touchpad gesture taxonomy

Real multi-touch cannot be synthesised remotely, so **the iPad recognises the gesture locally and sends a semantic id; the host resolves the id to a concrete action through its own map.** `native: true` means the host has a real event for it (mouse/scroll/media) with no keyboard emulation; `native: false` means it resolves to a keyboard chord.

| Gesture | Fingers | Windows 11 default | Windows action | macOS action | Native |
|---|---|---|---|---|---|
| `pointer.click` | 1 | Left click | mouse left | mouse left | ✔ |
| `pointer.doubleclick` | 1 | Double click | mouse left ×2 | mouse left ×2 | ✔ |
| `pointer.drag` | 1 | Tap-and-a-half drag | down/move/up | down/move/up | ✔ |
| `pointer.rightclick` | 2 | Right click | mouse right | mouse right | ✔ |
| `scroll.vertical` | 2 | Scroll | `MOUSEEVENTF_WHEEL` | pixel scroll | ✔ |
| `scroll.horizontal` | 2 | Horizontal scroll | `MOUSEEVENTF_HWHEEL` | pixel scroll | ✔ |
| `zoom.in` / `zoom.out` | 2 | Zoom | `ctrl+=` / `ctrl+-` | `cmd+=` / `cmd+-` | ✗ |
| `nav.back` / `nav.forward` | 2 | Back / Forward | `alt+←` / `alt+→` | `cmd+[` / `cmd+]` | ✗ |
| `system.search` | 3 | Open Search | `win+s` | `ctrl+cmd+d` (Look up) | ✗ |
| `workspace.overview` | 3 ↑ | Task View | `win+tab` | `ctrl+↑` (Mission Control) | ✗ |
| `workspace.showdesktop` | 3 ↓ | Show desktop | `win+d` | `fn+f11` | ✗ |
| `app.switchnext` | 3 → | Next app | `alt+tab` | `ctrl+→` | ✗ |
| `app.switchprev` | 3 ← | Previous app | `alt+shift+tab` | `ctrl+←` | ✗ |
| `pointer.middleclick` | 3 tap | *(opt)* middle click | mouse middle | — | ✔ |
| `system.notifications` | 4 tap | Notification centre | `win+n` | — | ✗ |
| `workspace.overview4` | 4 ↑ | Task View | `win+tab` | `ctrl+↑` | ✗ |
| `workspace.showdesktop4` | 4 ↓ | Show desktop | `win+d` | `ctrl+↓` (App Exposé) | ✗ |
| `workspace.next` | 4 → | Next virtual desktop | `win+ctrl+→` | `ctrl+→` | ✗ |
| `workspace.prev` | 4 ← | Prev virtual desktop | `win+ctrl+←` | `ctrl+←` | ✗ |
| `launcher` | 4 pinch-in | — | *(unsupported)* | `fn+f4` (Launchpad) | ✗ |
| `media.playpause` | 4 tap | *(opt)* play/pause | media | media | ✔ |
| `volume.up` / `volume.down` | 3 ↕ | *(opt)* audio mode | media | media | ✔ |

Two refinements worth building in:

- **App switching should hold the modifier.** Windows' native 3-finger swipe is a held Alt-Tab, not a discrete one. Emulate it: on first swipe send `alt` down + `tab`, keep `alt` held while further swipes arrive, release on finger-lift. The `hold: "alt"` field on those two entries marks this.
- **Pinch zoom has a better native path** than `ctrl+=`: `ctrl` held + `MOUSEEVENTF_WHEEL` gives continuous, proportional zoom instead of discrete steps. That's the `alt` field on the zoom entries; prefer it where the app supports it.

`launcher` is the one gesture with no Windows equivalent — it's declared `windows: null` and is therefore absent from the Windows capability doc's `gestures[]`, so the picker hides it automatically.

---

## 4. Capability model

The host emits one capability document when a session opens. The controller uses it for three jobs: order/filter the catalog, grey out keycaps on the 100% on-screen keyboard, and **refuse to save an unsupported action**.

### Validation rule (the enforcement point for requirement 4)

```js
function supports(cap, action) {
  const a = cap.actions[action.type];
  if (!a?.supported) return `action type '${action.type}' unsupported`;
  if (action.type === 'key') {
    if (!cap.keys.supported.includes(action.key))       return `key '${action.key}' not on this keyboard`;
    for (const m of action.mods ?? [])
      if (!cap.modifiers.includes(m))                   return `modifier '${m}' unsupported`;
    if ((action.mods ?? []).length > a.maxModifiers)    return 'too many modifiers';
  }
  if (action.type === 'media'   && !cap.media.includes(action.k))            return `media key '${action.k}' unsupported`;
  if (action.type === 'mouse'   && !cap.pointer.buttons.includes(action.b ?? 'left')) return 'button unsupported';
  if (action.type === 'gesture' && !cap.gestures.includes(action.id))        return `gesture '${action.id}' unsupported`;
  return null;  // null == allowed
}
```

Run it in the button editor's save path and in the catalog renderer. Against the real documents this yields 0/99 rejections on Windows and 46/99 on macOS — the `win` modifier alone disqualifies 40 entries, plus `printscreen`/`apps`/`win` keycaps and the `stop` media key. That is precisely the "user cannot add a button the target can't perform" guarantee, and it's data-driven rather than hardcoded per OS.

### Schema (draft 2020-12, validated)

Top level requires `schemaVersion`, `device`, `os`, `injector`, `actions`, `modifiers`, `keys`, `media`, `gestures`, `pointer`; optional `limits` and `warnings`.

- **`device`** — `id` is the stable per-host UUID that keys the saved board *and* the most-recently-connected ordering (requirements 3 and 5).
- **`os`** — `family` ∈ macos|windows|linux, `version` as a dotted-numeric string so `minOS` gates compare part-wise (Windows uses `10.0.<build>`), plus `build` and a marketing `name`.
- **`injector`** — `healthy` plus `permission.model` ∈ `accessibility` | `uipi` | `none`, `granted`, and Windows-only `integrity` ∈ low|medium|high|system. This is the single field the connect sheet reads to decide whether to show a permission nag.
- **`actions`** — per-type capability objects, not a flat list, so each type carries its own constraints: `key.maxModifiers` / `key.scanCodeFallback`; `text.maxLength` / `unicode` / `beyondBMP`; `open.targetKinds`; `shell`/`script` `dialects` + `default` + `requiresConfirm`; `mouse.buttons`; `scroll.axes`; `multi.maxSteps`. **An absent type is unsupported** — that's how a Linux or restricted host degrades safely without a schema change.
- **`keys`** — `layout` (`ansi-104` / `ansi-mac` / `iso-105` / `jis`) drives which physical keycaps the full on-screen keyboard draws; `supported[]` decides which are enabled. This is exactly what requirement 9 needs.
- **`gestures`** — the ids from `gestures.json` that resolve on this target.
- **`pointer`** — `absolute` / `relative` / `virtualDesktop`, `buttons`, and `wheel.unit` ∈ `pixel` (macOS pixel-precise) | `line` | `delta` (Windows `WHEEL_DELTA` quanta) with `deltaPerNotch`. `displays[]` lets the client show a mini monitor map.
- **`warnings[]`** — typed `{code, message, severity}`, surfaced in the connect sheet.

### Worked example — Windows (abridged; full file on disk)

```json
{
  "schemaVersion": 1,
  "device": { "id": "7b2f1c04-…", "name": "STUDIO-PC", "arch": "x64",
              "lan": { "host": "192.168.1.42", "port": 8787 } },
  "os": { "family": "windows", "version": "10.0.22631", "build": "22631.4317",
          "name": "Windows 11 23H2" },
  "injector": { "name": "mdinput-win", "healthy": true,
    "permission": { "model": "uipi", "granted": true, "integrity": "medium",
      "detail": "Running unelevated. Input is delivered to processes at medium integrity or below; elevated windows and the UAC secure desktop will not respond." } },
  "actions": {
    "key":   { "supported": true, "maxModifiers": 4, "scanCodeFallback": true },
    "text":  { "supported": true, "maxLength": 4096, "unicode": true, "beyondBMP": true },
    "media": { "supported": true },
    "mouse": { "supported": true, "buttons": ["left","right","middle","x1","x2"], "maxClicks": 3 },
    "scroll":{ "supported": true, "axes": ["x","y"] },
    "open":  { "supported": true, "targetKinds": ["app","url","path","protocol"] },
    "shell": { "supported": true, "dialects": ["powershell","pwsh","batch"],
               "default": "powershell", "requiresConfirm": true },
    "script":{ "supported": true, "dialects": ["powershell","vbscript"],
               "default": "powershell", "requiresConfirm": true },
    "gesture": { "supported": true }, "delay": { "supported": true },
    "multi": { "supported": true, "maxSteps": 24 }
  },
  "modifiers": ["ctrl","shift","alt","win"],
  "keys": { "layout": "ansi-104", "supported": [ /* 109 names incl. printscreen, apps, win, f1–f24, numpad */ ] },
  "media": ["playpause","next","prev","stop","mute","soundup","sounddown"],
  "gestures": [ /* 24 ids — everything except `launcher` */ ],
  "pointer": { "absolute": true, "relative": true, "virtualDesktop": true,
    "buttons": ["left","right","middle","x1","x2"], "maxClicks": 3,
    "wheel": { "vertical": true, "horizontal": true, "unit": "delta", "deltaPerNotch": 120 },
    "displays": [ { "id": "\\\\.\\DISPLAY1", "w": 2560, "h": 1440, "scale": 1.0, "primary": true },
                  { "id": "\\\\.\\DISPLAY2", "w": 1920, "h": 1080, "scale": 1.25, "primary": false } ] },
  "limits": { "maxTextLength": 4096, "maxMultiSteps": 24, "maxDelayMs": 10000, "maxEventsPerSecond": 500 },
  "warnings": [
    { "code": "uipi.unelevated", "severity": "warn",
      "message": "Agent is unelevated. Keystrokes sent to an elevated window (Task Manager, an admin terminal, a UAC prompt) are silently dropped." },
    { "code": "sas.unavailable", "severity": "info",
      "message": "Ctrl+Alt+Del cannot be synthesised by any user-mode process." },
    { "code": "brightness.unavailable", "severity": "info",
      "message": "No brightness virtual-key exists on Windows; brightness would need WMI and only works on internal panels." }
  ]
}
```

### Worked example — macOS (the deltas that matter)

```json
{
  "os": { "family": "macos", "version": "15.5.0", "build": "24F74", "name": "macOS 15 Sequoia" },
  "injector": { "name": "mdinput", "healthy": true,
    "permission": { "model": "accessibility", "granted": true,
      "detail": "AXIsProcessTrusted() returned true. Events post to the HID event tap." } },
  "modifiers": ["cmd","shift","alt","ctrl","fn"],
  "keys": { "layout": "ansi-mac", "supported": [ /* 102 names; adds fn, forwarddelete, help, numclear;
                                                    drops win, apps, printscreen, scrolllock, pause, numlock, f20–f24 */ ] },
  "media": ["playpause","next","prev","mute","soundup","sounddown",
            "brightnessup","brightnessdown","illuminationup","illuminationdown"],
  "actions": {
    "key":    { "supported": true, "maxModifiers": 5, "scanCodeFallback": false },
    "shell":  { "supported": true, "dialects": ["zsh","bash","sh"], "default": "zsh", "requiresConfirm": true },
    "script": { "supported": true, "dialects": ["applescript","jxa"], "default": "applescript", "requiresConfirm": true }
  },
  "pointer": { "buttons": ["left","right","middle"],
    "wheel": { "vertical": true, "horizontal": true, "unit": "pixel", "deltaPerNotch": 10 } },
  "warnings": [
    { "code": "securekeyboard", "severity": "info",
      "message": "While a password field has Secure Input engaged, synthesised keystrokes are suppressed by the OS." },
    { "code": "printscreen.absent", "severity": "info",
      "message": "No PrintScreen / Menu / Windows keys exist on this layout; use the Screenshot shortcuts instead." }
  ]
}
```

**Asymmetries the model captures:** Windows-only keys `win`, `apps`, `printscreen`, `scrolllock`, `pause`, `numlock`, `f20`–`f24`, plus X1/X2 mouse buttons, scan-code injection, and `protocol` open targets. macOS-only: the `fn` modifier, `forwarddelete`/`help`/`numclear`, brightness and keyboard-illumination media keys, pixel-precise scrolling, and the `launcher` gesture. Script dialects diverge completely (`applescript`/`jxa` vs `powershell`/`vbscript`), which is why I'd recommend generalising the existing `applescript` action type to `script` with a `dialect` field — keeping `applescript` as an alias so the current `config.json` keeps loading.

### One naming note

The existing `config.json` uses `mods:["cmd"]` for macOS. I kept `win` and `cmd` as **distinct tokens** rather than a shared `meta`, because the capability filter's whole value is that a `win`-modified button is *provably* invalid on a Mac and vice versa — collapsing them into `meta` would silently let 40 Windows-only buttons onto a Mac board. If you'd rather store `meta` canonically and render per-OS, that works too, but then the filter needs a separate per-OS chord-validity table to recover the same guarantee.

**Sources:** [SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput) · [MOUSEINPUT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-mouseinput) · [KEYBDINPUT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-keybdinput) · [Virtual-Key Codes](https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes) · [Windows keyboard shortcuts](https://support.microsoft.com/en-us/windows/keyboard-shortcuts-in-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec) · [Touchpad gestures](https://www.microsoft.com/en-us/windows/learning-center/touchpad-gestures) · [.NET Framework on Windows 11](https://learn.microsoft.com/en-Us/dotnet/framework/install/on-windows-11)