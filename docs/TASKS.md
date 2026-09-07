# MOUSENDECK — task list

From `SNSKN PROJECT work.pdf` (5 pages, 25 Aug 2026). Ticked as each lands.

---

## A · Phone version and QR selection

- [x] **A1** Build a phone/mobile UI variant (portrait-first, one-handed)
- [x] **A2** ~~Choose the target in the terminal~~ → **revised 25 Aug:** switch
      layout inside the web app instead, with a button beside the
      macOS/Windows switch that toggles iPad ⇄ Mobile
- [x] **A3** ~~Separate QR per screen type~~ → not needed: one URL serves both,
      the layout is chosen in the app

## B · Latency

- [x] **B1** Latency. Fixed a real measurement bug (probes carried no
      timestamp, so overlapping ones mis-read), tightened the keep-alive to
      100 ms to stop the iOS radio power-parking, and the header now shows the
      best round-trip alongside the average.
      **Caveat:** sub-5 ms *measured* is reachable on a good link, but the iPad
      samples touch at 60 Hz, so perceived lag cannot beat one 16.7 ms frame.

## C · Custom shortcut editor  *(iPad + mobile)*

- [x] **C1** Icon field: link out to flaticon.com so an icon can be pasted in
- [x] **C2** Only *custom* shortcuts are editable — built-ins are add/remove only
- [x] **C3** Centre the editor sheet; scroll inside it when it overflows
- [x] **C4** Tapping the Shortcut box opens the on-screen keyboard for the
      current platform (macOS or Windows) to capture the combo
- [x] **C5** Press-and-hold a key to select it; selected keys stay highlighted
- [x] **C6** Press-and-hold a selected key again to unselect it
- [x] **C7** Fade in an order number (1, 2, 3 …) on each selected key, so the
      key order of the combo is visible
- [x] **C8** Save shortcut / Discard changes / Done — Done when nothing has
      changed, Save + Discard when something has
- [x] **C9** Reopening a shortcut shows its saved keys already highlighted

## D · Add-shortcut catalog  *(iPad + mobile)*

- [x] **D1** Centre the catalog sheet; scroll inside it
- [x] **D2** Show a "Custom shortcuts" section — only when custom ones exist
- [x] **D3** Every suggested shortcut must match the connected platform
      (macOS shortcuts on a Mac, Windows shortcuts on a PC)

## E · Persistence

- [x] **E1** Every customisable change and every setting persists, and is shared
      between phone and iPad across restarts

## F · Settings

- [x] **F1** Explain each slider — Pointer speed, Acceleration, Scroll speed,
      Board columns — so they are not unlabelled numbers

## G · Terminal lifecycle

- [x] **G1** A `disconnect` command that stops the background process
- [x] **G2** Surface it beside the header at the top of the UI
- [x] **G3** Persistent reminder between the latency figure and the switch
      button, telling you to run it when you are done (worded properly)

## H · Board tiles

- [x] **H1** Show the shortcut under every tile, truncated with `…` when long,
      in the connected platform's notation

## I · Cleanup

- [x] **I1** Remove the four sticky modifier buttons (⌘ ⌥ ⌃ ⇧) under the pad
- [x] **I2** Remove the Mid mouse button — Left and Right only

## K · Trackpad  *(added 25 Aug)*

- [x] **K1** Three-finger swipe ←→↑↓ (spaces / Mission Control / Task View)
- [x] **K2** Four-finger swipe ←→↑↓ (desktop switching)
- [x] **K3** Two-finger pinch / spread → zoom out / in
- [x] **K4** Four-finger pinch / spread → Launchpad / Show Desktop
- [x] **K5** Three-finger tap → middle click (replaces the removed Mid button)
- [ ] **K6** ~~Force Touch pressure sensitivity~~ → **not possible:** the
      iPad 9 has no pressure sensor under the glass. What a MacBook varies by
      *speed* is already implemented as the acceleration curve.

## J · Documentation

- [x] **J1** README covering every feature and user story, in full

---

## Round 2 — `SNSKN PROJECT work (1).pdf` + follow-ups (25 Aug)

- [x] **L1** Suggested shortcut for full-screen screenshot *(already ⌘⇧3;
      added ⌘⌃⇧3 and ⌘⌃⇧4 to copy straight to the clipboard)*
- [x] **L2** Record entire screen — one tap, via `screencapture -v`, saved to
      the Desktop with a timestamp
- [x] **L3** Record a selected area, plus a **Stop Recording** button that
      ends the capture cleanly with SIGINT
- [x] **L4** **Finder bug.** `open -a Finder` activates an app that is always
      running and may have no window, so nothing happened. Now activates and
      creates a window if none exists — verified frontmost afterwards
- [x] **L5** **Do Not Disturb bug.** The stored button still carried ⌘⌥D,
      which toggles the Dock. Now runs a `Toggle DND` shortcut and, when that
      does not exist, explains exactly what to create and offers to open the
      Shortcuts app
- [x] **L6** Boards saved earlier kept the old broken actions. Built-ins are
      locked, so they now refresh from the catalog on connect
- [x] **L7** Audited every entry for duplicate or mislabelled combos.
      "Delete Line" renamed to "Del to Line Start" (⌘⌫ does not delete a line);
      "Window" screenshot is now ⌘⇧4 then space, not a duplicate of Snip Area
- [x] **M1** Latency reading was being clipped off the right edge in the iPad
      layout — it now never shrinks, and the reminder truncates instead
- [x] **M2** Brand no longer wraps to two lines in Windows mode
- [x] **M3** Both layouts are landscape; portrait shows a rotate prompt
- [x] **M4** Mobile shows one pane at a time — Shortcuts / Trackpad / Keyboard
      — with a switcher, and the keyboard is inline rather than a sheet
- [x] **M5** One device controls the Mac at a time. A second gets a lock
      screen naming the holder, with an explicit **Take over** so a stale tab
      can never lock you out

## Round 3 — fit, scale, header, terminal (25 Aug)

- [x] **N1** **Both UIs fit the screen.** The phone was overflowing the page
      by 23 × 92 px: the deck scrolled (428 px of tiles in 270 px) and the
      keyboard overran by 24 px. The board now sets an exact row count so rows
      stretch to fill the column, the keyboard shares out the height that is
      left, and the trackpad's 468 × 338 px minimum — the one thing that could
      push the stage wider than the screen — is gone. Measured: 0 overflow in
      every pane, both layouts
- [x] **N2** **Columns were coming out uneven.** `repeat(n, 1fr)` is
      `minmax(auto, 1fr)`, so a long caption widened its own column — five
      columns measured 71 / 111 / 90 / 71 / 79 px. Now `minmax(0, 1fr)`:
      five equal 80 px columns
- [x] **N3** **Tile text was clipping.** The tile's padding and inner gap were
      fixed px while the type scaled, so at 80% the fixed 28 px dominated and
      pushed the caption out. Everything is on one multiplier now, which makes
      the fit scale-invariant — content needs 53.8 px in a 61.7 px tile at 80%,
      and the same ratio at every other size
- [x] **N4** **Interface size, 5% at a time.** 50–150% in Settings, with − / ＋
      / **Fit**, saved per device *and* per layout. Fit is capped at 100%:
      rows already stretch to fill, so scaling past it would only inflate a
      26 px icon to 39 px in a tile still 80 px wide and truncate every label
- [x] **N5** First run on a screen fits itself — 100% on iPad, 80% on an
      844 px phone, 75% at 667 px. The estimate is corrected against a real
      measurement the moment the deck is actually on screen, since being 2 px
      out still scrolls. A size you have chosen yourself is never overridden
- [x] **N6** **One header everywhere.** The iPad/macOS header is now used in
      both shortcut styles and both layouts — same 56 px height, same order,
      same full wording. Dropped the `· Windows` suffix and the phone's
      shrunken variant. What gives on a narrow screen is decided by width, not
      by layout: prose → reminder → window-controls gap → wordmark. Verified
      no overflow at 1080, 844 and 667 px
- [x] **N7** **Trackpad gesture list is permanent.** It faded out on first
      touch and never returned, so the moment you needed it was the moment it
      was gone. Verified opacity 1 through touchstart / move / end
- [x] **N8** **`show connected device` in the terminal.** `connect` holds the
      terminal, so that is where you ask it questions — lists each device, its
      address, which one is driving, and how long it has been on. Plus `url`,
      `qr`, `accessibility`, `help`, `quit`. 14 tests, self-contained
- [x] **N9** Deck captions no longer print the first 18 characters of a shell
      line or AppleScript body — `tell application "Fin…` under a button
      already labelled Finder. They read `command` and `script`

## Round 4 — shortcuts that actually work (25 Aug)

- [x] **P1** **Buttons report failure.** The root cause behind most of this
      round: a button that did nothing pulsed the same green as one that
      worked, so a permission problem on the Mac looked like a broken button
      on the iPad. Every runner now returns a result, the server relays it,
      the tile goes red and the device explains why
- [x] **P2** **Finder fixed.** It ran AppleScript, which needs *Automation*
      permission — a different grant from the Accessibility one this project
      asks for. Without it osascript fails silently and nothing happens. Now
      `open ~`, which needs no permission at all and guarantees a window.
      Verified: Finder frontmost, 1 window, no error
- [x] **P3** **Do Not Disturb fixed.** Its failure path was an `osascript
      display dialog`, which from a background process registers as its own
      app — the "menu bar appearing" instead of an explanation. Removed; it
      now reports the one-time Shortcuts setup through the app instead
- [x] **P4** Suggested capture shortcuts added to the starter board: **Full
      Shot** (⌘⇧3), **Rec Screen**, **Rec Area** and **Stop Rec** — a
      recording you cannot stop from the deck is a trap
- [x] **P5** **Record Area** was just ⌘⇧5, which opens the capture bar in
      whatever mode it was last left in — press it after a screenshot and you
      get the photo tool. Now `screencapture -J video`, which always lands in
      "drag the area to record"
- [x] **P6** **Launchpad was wrong** — it sent ⌘⌥Space, which is Finder
      search. Now F4, and Finder Search added as its own entry
- [x] **P7** **Catalog entries are toggles.** They used to push a fresh copy
      per tap, so five taps left five identical buttons. Tap adds, tap again
      removes. Custom shortcuts never matched at all (compared against the
      board button's freshly-generated id), so they never showed a tick and
      always duplicated — now linked by `from`
- [x] **P8** Catalog gets the board editor's transactional footer: **Done**
      when clean, **Save changes** + **Discard changes** when not. Verified
      discard restores the entry list exactly
- [x] **P9** **`open ~` did not expand `~`** — execFile runs no shell, so it
      resolved against the working directory. Caught by the new test
- [x] **P10** **Lost error messages.** `runShell` listened for `exit`, which
      can fire before the last chunk of piped stderr arrives — so a
      fast-failing command intermittently reported *success*. Now `close`.
      Found by a flaky test; three clean runs after
- [x] **Q1** **Hotspot / endless loading.** Confirmed by measurement: the
      hotspot address served in 6.7 ms and `.local` in 8.8 ms, while the old
      Wi-Fi address was unreachable. A hotspot is fine — the stale address is
      the problem, and nothing in the app can report it because the page never
      loads. The server now watches for the address changing and reprints the
      QR unprompted, `address` re-checks on demand, and the banner offers the
      `.local` URL for the Home Screen because it survives the change
- [x] **Q2** Address selection follows the default route rather than Node's
      arbitrary interface order, and skips VPN / AWDL / bridge interfaces
- [x] **Q3** Banner says "iPad or phone camera"
- [x] **Q4** Catalog section renamed "Your shortcuts" → **Custom shortcuts**.
      It had not gone anywhere — it only renders once you have at least one
      custom, and sits above Editing at the top of a long scroll
- [x] **Q5** **★ marks a custom button** on the board, top-left, always visible.
      Inset past the 14px corner radius: at 4px/3px the glyph fell outside the
      curve and read as escaping the tile. Size is floored at 9px too, since
      purely proportional it lands at 5px when the interface scales to 50% —
      a speck rather than a marker. Verified inside the radius and clear of
      the icon in both layouts at 50/75/100/125/150%
- [x] **Q6** URL in the banner is glob-safe to paste: zsh treats the `?` in
      `?k=…` as a pattern and refuses with "no matches found"

## Round 5 — catalog expansion (25 Aug)

Built from Apple's official *Mac keyboard shortcuts* page plus a general
shortcut roundup. **Where the two disagreed, Apple won** — the roundup gives
invert-colours as ⌘⌥Comma and muddles the Mac function-key row; Apple documents
⌃⌥⌘8 and ⌃⌥⌘Comma.

- [x] **R1** macOS catalog **80 → 209**, Windows **53 → 120** (329 total).
      New categories: **Formatting**, **Go to**, **Code**, **Terminal**
- [x] **R2** Terminal category is *control chords*, not shell commands — ⌃C,
      ⌃R, ⌃L, ⌃U, ⌃W land in whatever shell is in front. A `shell` action runs
      detached and never touches the terminal you are looking at, so it would
      have been the wrong mechanism entirely
- [x] **R3** **No Fn entries shipped.** Apple documents Fn-C / Fn-N / Fn-A /
      Fn-Shift-A for Control Centre, Notification Centre, Dock and Apps, but
      macOS reads the real Fn key from hardware and `.maskSecondaryFn` does not
      reliably reach the WindowServer hotkey layer. Tested: a non-Fn chord
      (⌥⌘D) verifiably flipped `com.apple.dock autohide` 0→1, while Fn-N gave
      no signal that survived scrutiny — the NotificationCenter window count
      moves on its own. Shipped shell equivalents (`pmset sleepnow`,
      `open -a ScreenSaverEngine`) and real Home/End/PageUp/PageDown keycodes
      instead of the Fn-arrow spellings
- [x] **R4** Every macOS entry validated against the Swift helper's keycode
      table — 209/209 sendable, no unknown modifiers, no duplicate ids across
      both catalogs. Shifted characters (`:` `?` `{` `}` `|` `+`) are sent as
      the unshifted key plus Shift, since there is no separate keycode

### Process note

Several buttons were lost from the live board during this round because UI
verification was driven against the real `board.json` rather than a scratch
fixture — synthetic clicks toggled catalog entries off and saved. Restored, but
the lesson holds: read-only DOM checks for anything that touches saved state,
and never click through a board that is not disposable.

---

### Notes / open questions

- **B1** is the one item I cannot promise. Sub-5 ms over Wi-Fi is below the
  iPad's own 60 Hz touch sampling interval (16.7 ms), so the *measured*
  round-trip can get there but end-to-end perceived lag cannot go below one
  frame. I will report real measurements rather than a target number.
- **A2/A3** assume the phone and iPad share one board unless told otherwise.
