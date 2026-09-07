# iPad 9th gen (10.2") layout engineering for MOUSENDECK

## 0. What I verified vs. what I derived

| Claim | Status |
|---|---|
| 2160 × 1620 px, 264 ppi, 10.2" IPS, 500 nits | **Verified** — Apple tech specs (via search) + Wikipedia spec table |
| 250.6 × 174.1 × 7.5 mm (9.87 × 6.85 × 0.30 in), 487 g | **Verified** — Wikipedia spec table (matches your 9.8 × 6.8 × 0.29) |
| CSS viewport 810 × 1080 pt portrait / 1080 × 810 landscape, DPR 2 | **Verified** — YesViz device DB for iPad 10.2 |
| 60 Hz, no ProMotion | **Verified** — multiple sources; ProMotion absent from Apple's spec sheet |
| Home button + Touch ID, last iPad with a home button | **Verified** — Wikipedia |
| Status bar = 20 pt on home-button iPads (24 pt on Face-ID iPads) | **Verified** — Geoff Hackworth / Use Your Loaf iPad layout analyses |
| `env(safe-area-inset-*)` = 0 on non-notch devices | **Verified** — Polypane / jipfr.nl safe-area writeups |
| Safari chrome ≈ 70 pt (toolbar only) / ≈ 103 pt (toolbar + tab bar) in landscape | **Verified by arithmetic on a measured case** — Apple Dev Forums thread 735055: iPad Air 3 (landscape height 834) reported `innerHeight` 764 and 731. 834−764 = **70**, 834−731 = **103**. Safari chrome is a fixed *point* height across iPads, so these carry to the iPad 9. **Re-measure on device before hardcoding.** |
| iPad 9 runs iPadOS 26 | **Verified** — Apple compatibility list |
| iPadOS 26 windowed PWAs get traffic-light overlays and `env()` does *not* compensate | **Verified** — dev.to writeup demonstrating the WebKit safe-area demo failing on iPad |
| WCAG 2.2 SC 2.5.8 = 24 × 24 CSS px (AA); 2.5.5 = AAA | **Verified** — W3C Understanding doc |
| Apple HIG minimum 44 × 44 pt | **Verified indirectly** — Apple's own Layout page returned truncated to WebFetch; the 44 pt figure is confirmed by multiple secondary sources quoting HIG. Treat as high-confidence, not a direct quote. |
| MacBook Air M2 trackpad = 98.5 × 62.3 mm | **NOT verified** — only an AliExpress parts wiki said this and it is almost certainly the *module* not the glass. I do **not** rely on it below; I anchor trackpad sizing on physical mm converted from the iPad's own ppi instead. |

---

## 1. Display, viewport and safe areas

### 1.1 Hard numbers

```
Native pixels          2160 x 1620   (landscape)  /  1620 x 2160 (portrait)
Points / CSS px        1080 x  810   (landscape)  /   810 x 1080 (portrait)
devicePixelRatio       2
PPI (device px)        264
PPI (CSS px)           132           <- 264 / 2
1 CSS px               0.19242 mm    <- 25.4 / 132
Refresh                60 Hz, no ProMotion  -> 16.67 ms frame budget
Active screen area     207.8 x 155.9 mm   (8.18 x 6.14 in)
```

Because DPR is exactly 2 and there is no display zoom on this model, **1 CSS px === 1 iOS point**. Every Apple HIG "pt" number can be used verbatim as a CSS px number. No conversion table needed.

### 1.2 Bezels — and why they matter for this app

| Axis | Device | Screen | Bezel each side |
|---|---|---|---|
| Long (landscape L/R) | 250.6 mm | 207.8 mm | **21.4 mm** |
| Short (landscape T/B) | 174.1 mm | 155.9 mm | **9.1 mm** |

This is a real design advantage over a modern bezel-less iPad. Held in landscape with two hands, **the thumbs rest on 21.4 mm of glass-free bezel and never touch the panel.** Consequences:

- You do **not** need palm-rejection dead gutters at the left/right screen edges. The layout can run edge-to-edge.
- No rounded-corner content clipping (this model has square display corners).
- No home indicator swipe-up strip stealing the bottom 34 pt.

### 1.3 CSS viewport in each mode

| Mode | Landscape (w × h) | Portrait (w × h) |
|---|---|---|
| **Safari, toolbar + tab bar** (iPadOS default) | 1080 × **707** | 810 × **977** |
| **Safari, toolbar only** (tab bar hidden) | 1080 × **740** | 810 × **1010** |
| **Standalone PWA, `black-translucent` + `viewport-fit=cover`** | 1080 × **810** | 810 × **1080** (top 20 px under status bar) |
| **Standalone PWA, `default`/`black` status bar** | 1080 × **790** | 810 × **1060** |
| **iPadOS 26 windowed PWA** | variable, window-controls overlay top-leading | variable |

**Safari costs you 103 px — 12.7% of the landscape height.** That is one full deck row. Make "Add to Home Screen" a first-run requirement, not a suggestion.

### 1.4 Safe-area insets: what "no notch, no home indicator" actually means

On the iPad 9, **all four `env(safe-area-inset-*)` values are `0px`** in every orientation, in both Safari and standalone. There is no notch, no Dynamic Island, no home indicator, and no rounded display corner for iOS to compensate for.

Your current `style.css` does this:

```css
--pad-top: env(safe-area-inset-top);
--pad-bottom: env(safe-area-inset-bottom);
```

Combined with `apple-mobile-web-app-status-bar-style: black-translucent` in `index.html`, this is **a latent bug on this exact device**: in standalone mode the status bar is translucent and the web view is given the full 810 px, but `safe-area-inset-top` returns `0`, so your header renders *underneath the clock and battery indicator*. This is the classic iPhone-6-era black-translucent trap and it applies verbatim here.

Fix — hardcode the 20 pt band and let `env()` win only where it is non-zero:

```css
:root {
  /* home-button iPad: status bar is 20pt, env() reports 0 */
  --status-bar: 20px;
  --pad-top: max(env(safe-area-inset-top), var(--status-bar));
  --pad-bottom: env(safe-area-inset-bottom);      /* 0 here, 34 on modern iPads */
  --wc-inset: 0px;                                 /* iPadOS 26 window controls */
}
/* In Safari the chrome already covers the status bar — no band needed */
@media (display-mode: browser) { :root { --status-bar: 0px; } }
```

If you prefer not to lose the 20 px at all, switch to `apple-mobile-web-app-status-bar-style: black` (opaque). You then get 1080 × 790 landscape with zero risk of overlap. **Recommended for v1** — 20 px of guaranteed-clean height beats 20 px of edge-to-edge that you have to defend forever.

### 1.5 iPadOS 26 caveat (this device runs it)

iPadOS 26 replaced Split View/Slide Over with real windowing, and it reaches the iPad 9. Standalone PWAs get traffic-light window controls at the **top-leading** corner, `env()` does not compensate, and there is no Window Controls Overlay API on iPadOS. Design rule that falls out of this:

> **Reserve the leading 132 × 44 CSS px of the header for a non-interactive brand/drag zone.** Never put the connect button, the timer, or an icon button there.

Measure at runtime rather than trusting any table:

```js
const vv = window.visualViewport;
const V = { w: vv.width, h: vv.height, dpr: devicePixelRatio,
            standalone: matchMedia('(display-mode: standalone)').matches
                     || navigator.standalone === true };
document.documentElement.style.setProperty('--vh', vv.height + 'px');
vv.addEventListener('resize', recalc);
```

Then size the shell with `height: 100dvh` and the measured `--vh` as a fallback, never `100vh`.

---

## 2. Landscape-first layout (the primary layout)

### 2.1 Which side gets the trackpad, and which hand holds the iPad

**Trackpad on the RIGHT. Deck on the LEFT. User-flippable in one tap.**

Reasoning:

1. **Desk-mounted is the dominant posture.** This device sits beside the Mac as a control surface. In that posture "which hand holds it" is moot and the governing metaphor is a physical desk: keyboard/macro pad to the left, mouse to the right. Right-handers reach the trackpad with the right hand without crossing over the deck.
2. **Handheld posture agrees.** Held in two hands in landscape, the left hand grips and the right index finger drives the pointer. The deck under the left thumb is *also* correct — the left thumb can reach roughly the leading 180 px of the panel, which covers the first deck column.
3. **Left-handers are ~10% of your users** and this is a 40-line CSS change: `flex-direction: row-reverse` on the work area behind a `--handedness` toggle in Settings. Ship it. It is the single highest-leverage accessibility affordance in the whole layout.

Note the tradeoff: with trackpad-right, the deck's *first* column is the most reachable by a held-in-left-hand thumb, so **sort each board so the most-used buttons land in column 1**, and make that the default ordering when a board is auto-generated from the catalog.

### 2.2 The grid

Standalone, opaque status bar, **1080 × 790** working canvas (I use the safer of the two standalone modes; if you go translucent you gain 20 px of slack, don't spend it):

```
VERTICAL
  y   0 ..  20   status band            20 px   (opaque status bar OR hardcoded pad)
  y  20 ..  76   header                 56 px
  y  76 ..  88   gap                    12 px
  y  88 .. 794   WORK AREA             706 px
  y 794 .. 810   bottom margin          16 px

HORIZONTAL
  x   0 ..  16   margin                 16 px
  x  16 .. 572   TRACKPAD COLUMN       556 px   (51.5%)
  x 572 .. 592   gutter                 20 px   ( 1.9%)
  x 592 ..1064   DECK COLUMN           472 px   (43.7%)
  x1064 ..1080   margin                 16 px
                                       -----
                                       1080 px  ✓
```

**Trackpad column, 556 × 706:**

| Block | Size | Physical |
|---|---|---|
| Trackpad surface | 556 × 556 | **107.0 × 107.0 mm** |
| gap | 12 | |
| Click row (L 222 / 6 / MID 100 / 6 / R 222) | 556 × 62 | 11.9 mm tall |
| gap | 12 | |
| Modifier strip (⌘ ⌥ ⌃ ⇧ + Keyboard) | 556 × 64 | 12.3 mm tall |
| **Total** | **706** ✓ | |

**Deck column, 472 × 706:**

| Block | Size |
|---|---|
| Board header (name, page N/M, `+`) | 472 × 40 |
| gap | 12 |
| Grid — 4 cols × 5 rows, cell **109 × 109**, gap 12 | 472 × 593 |
| gap | 12 |
| Page pills + Edit Board | 472 × 40 |
| **Total** | **697** (9 px slack) |

Grid arithmetic: `4 × 109 + 3 × 12 = 472` ✓ and `5 × 109 + 4 × 12 = 593` ✓.

### 2.3 Minimum trackpad area that still feels good

Anchor this in millimetres, not pixels. A 2009–2012 MacBook Pro trackpad (~105 × 75 mm) is the universally-accepted floor for "this feels like a real trackpad."

| | CSS px | mm | Verdict |
|---|---|---|---|
| Hard floor | **468 × 338** | 90 × 65 | below this, two-finger scroll runs out of runway |
| Comfortable | **520 × 400** | 100 × 77 | 3-finger swipes land reliably |
| **Recommended (landscape)** | **556 × 556** | **107 × 107** | 4-finger gestures have headroom |
| Portrait | 778 × 449 | 150 × 86 | wider than any laptop trackpad |

The recommended surface is **near-square (1.0:1)**, which looks wrong next to a real 1.6:1 laptop trackpad. It isn't. Trackpads are wide because of laptop chassis geometry, not because of pointer mapping — a *relative* pointer with acceleration is aspect-ratio-agnostic. What matters is absolute travel per axis, and 107 mm on both axes beats every laptop trackpad on the vertical axis.

Enforce the floor in CSS so any future layout change can't silently break it:

```css
#pad { min-width: 468px; min-height: 338px; touch-action: none; }
```

### 2.4 How many deck buttons fit (472 px wide × 593 px grid box)

| Columns | Cell | Physical | Rows that fit | Buttons/page | Verdict |
|---|---|---|---|---|---|
| 3 | 149 px | 28.7 mm | 3 | 9 | glanceable, wasteful |
| **4** | **109 px** | **21.0 mm** | **5** | **20** | **default** |
| 5 | 84 px | 16.2 mm | 6 | 30 | dense but labels still legible at 13 px |
| 6 | 68 px | 13.1 mm | 7 | 42 | icon-only, 2-word labels max |
| 7 | 57 px | 11.0 mm | 8 | 56 | icon-only; at the HIG floor |
| 8 | 48 px | 9.2 mm | 10 | 80 | **do not ship as default** — 48 px clears HIG 44 but labels are unreadable |

Your existing `#cols` slider (`min=2 max=8`) maps onto this table directly. Change its default to **4** and label the stops *Comfortable (4) / Standard (5) / Dense (6)*, hiding 7–8 behind an "expert" disclosure.

For reference: **20 buttons/page beats a Stream Deck (15) and a Stream Deck Mini (6)**, and with paging you exceed the XL's 32 on page two.

### 2.5 Header (1080 × 56)

```
 x:  16 [ 132 brand/drag ] [ 260 device chip ] 12 [ 120 timer ] <-flex 108-> [ 92 latency ] 8 [44] 8 [44] 12 [ 208 CONNECT ] 16
```

- **Leading 132 px is the iPadOS-26 window-controls safe zone.** Brand wordmark only, `pointer-events: none`.
- **Connect/Disconnect pill: 208 × 44, trailing edge.** Trailing because (a) window controls are leading, (b) it sits directly above the trackpad column, where the dominant hand already is. Tapping it when connected disconnects and immediately re-reveals the device list; tapping when disconnected opens the list popover.
- **Session timer: 120 px, `font-variant-numeric: tabular-nums`,** 20 px monospaced digits, format `H:MM:SS` (collapse to `MM:SS` under an hour). Tabular numerals are non-negotiable — proportional digits make the timer visibly twitch every second, which is exactly the kind of motion that pulls the eye away from the trackpad.
- Accessibility: `role="timer"` with `aria-live="off"`. **Never** let a VoiceOver user hear the seconds tick. Provide the elapsed time on demand via the device chip's accessible name instead.
- Latency chip reuses your existing `#latency` colour thresholds.

### 2.6 Device list popover (revealed by Connect)

- Anchored below the Connect pill, trailing-aligned. **380 px wide**, max-height **560 px**, then scrolls.
- **Row height 72 px** — comfortably above HIG, and enough for two lines: device name + OS badge on line 1; `192.168.1.42 · last connected 2 min ago` on line 2, plus capability pips (`⌘ media shell osascript`).
- Ordered most-recently-connected first. Row 1 gets a "Reconnect" affordance so the common case is *two taps total* (Connect → row 1).
- While disconnected, the trackpad and deck panes render at `opacity: .38`, `pointer-events: none`, `aria-disabled="true"`, with a single centred "Not connected" line. Do not hide them — keeping them visible preserves spatial memory and makes the connect state unambiguous.

### 2.7 Landscape wireframe

```
+------------------------------------------------------------------------------+
|:::::::::::::: iOS status bar band - 20 px - overlay only ::::::::::::::::::::|
+------------------------------------------------------------------------------+
| MOUSENDECK | Satish-MBP macOS | 00:14:32 |  12 ms | [e] | [s] |[ DISCONNECT ]|
+------------------------------------------------------------------------------+
| +--------------------------------------+  +--------------------------------+ |
| |                                      |  | BOARD: Coding      page 1/3 [+]| |
| |                                      |  +--------------------------------+ |
| |                                      |  | +-----+-----+-----+-----+      | |
| |                                      |  | |Copy |Paste|Undo |Redo |      | |
| |                                      |  | +-----+-----+-----+-----+      | |
| |            T R A C K P A D           |  | +-----+-----+-----+-----+      | |
| |           556 x 556 CSS px           |  | |Find |Save |Quit |Tabs |      | |
| |            107 x 107 mm              |  | +-----+-----+-----+-----+      | |
| |                                      |  | +-----+-----+-----+-----+      | |
| |     drag = move   tap = click        |  | |Mute |Vol- |Vol+ |Play |      | |
| |     2f = scroll   2f tap = right     |  | +-----+-----+-----+-----+      | |
| |     3f/4f = gestures                 |  | +-----+-----+-----+-----+      | |
| |                                      |  | |Term |Code |Mail |Slack|      | |
| |                                      |  | +-----+-----+-----+-----+      | |
| |                                      |  | +-----+-----+-----+-----+      | |
| |                                      |  | |Lock |Shot |Msn  |Desk |      | |
| +--------------------------------------+  | +-----+-----+-----+-----+      | |
| +------------+-----+-------------------+  +--------------------------------+ |
| |    LEFT    | MID |       RIGHT       |  | (o) (o) (o)      [ EDIT BOARD ]| |
| +------------+-----+-------------------+  +--------------------------------+ |
| +-----+-----+-----+-----+--------------+                                     |
| | cmd | opt | ctl | shf |  KEYBOARD    |                                     |
| +-----+-----+-----+-----+--------------+                                     |
+------------------------------------------------------------------------------+
   |<------------ 556 px ------------>|20|<--------- 472 px ---------->|
```

(Wireframe shows trackpad-right flipped to the left for ASCII legibility of the deck; ship it trackpad-**right** by default per §2.1, i.e. mirror this drawing.)

---

## 3. Portrait fallback

Working canvas **810 × 1060** (opaque status bar).

**Deck on top, trackpad on the bottom.** Rationale: propped in portrait on a desk or stand, the bottom of the panel is nearest the user's hand and furthest from their eyeline — exactly the laptop arrangement (display up, trackpad near you). The deck is a *look-then-tap* surface and belongs where you're already looking.

```
VERTICAL
  y    0 ..   20   status band          20
  y   20 ..   76   header               56
  y   76 ..   88   gap                  12
  y   88 .. 1044   WORK AREA           956
  y 1044 .. 1060   bottom margin        16

WORK AREA (956, content width 778 with 16 px margins)
  DECK BLOCK        433
     board header    40
     gap             12
     grid  6 x 3, cell 119, gap 12   ->  778 x 381
  gutter             20
  TRACKPAD BLOCK    503
     surface        429     (778 x 429  =  150 x 83 mm)
     gap             12
     click row       62     (310 / 6 / 146 / 6 / 310)
                    -----
                     956  ✓
```

Portrait deck densities (grid box 778 × 381):

| Cols | Cell | mm | Rows | Buttons |
|---|---|---|---|---|
| 4 | 184 px | 35.4 | 2 | 8 |
| 5 | 146 px | 28.1 | 2 | 10 |
| **6** | **119 px** | **22.9** | **3** | **18** ← default |
| 7 | 100 px | 19.2 | 3 | 21 |
| 8 | 86 px | 16.5 | 4 | 32 |

Portrait gives **18 buttons but a 150 mm-wide trackpad**; landscape gives **20 buttons and a 107 mm-square trackpad**. Portrait is genuinely better for the *trackpad* and worse for the *deck* — which is why landscape is the default but portrait is a real layout, not a degraded one. Set `"orientation": "any"` in the manifest (you already do).

### 3.1 Portrait wireframe

```
+----------------------------------------------------------+
|:::::::: iOS status bar band  20 px  overlay only ::::::::|
+----------------------------------------------------------+
| MOUSENDECK | Satish-MBP macOS | 00:14:32 | [ DISCONN ]   |
+----------------------------------------------------------+
| +------------------------------------------------------+ |
| | BOARD: Coding                          page 1/3  [+] | |
| +------------------------------------------------------+ |
| | +-----+  +-----+  +-----+  +-----+  +-----+  +-----+ | |
| | | Copy|  |Paste|  | Undo|  | Redo|  | Find|  | Save| | |
| | +-----+  +-----+  +-----+  +-----+  +-----+  +-----+ | |
| | +-----+  +-----+  +-----+  +-----+  +-----+  +-----+ | |
| | | Cut |  | Quit|  | Tabs|  | Mute|  | Vol-|  | Vol+| | |
| | +-----+  +-----+  +-----+  +-----+  +-----+  +-----+ | |
| | +-----+  +-----+  +-----+  +-----+  +-----+  +-----+ | |
| | | Term|  | Code|  | Mail|  |Slack|  | Lock|  | Shot| | |
| | +-----+  +-----+  +-----+  +-----+  +-----+  +-----+ | |
| | (o) (o) (o)                        [ EDIT BOARD ]    | |
| +------------------------------------------------------+ |
|                                                          |
| +------------------------------------------------------+ |
| |                                                      | |
| |                                                      | |
| |                                                      | |
| |                T R A C K P A D                       | |
| |                                                      | |
| |              778 x 429 CSS px                        | |
| |               150 x 83 mm                            | |
| |                                                      | |
| |      drag = move       tap = click                   | |
| |      2f = scroll       2f tap = right-click          | |
| |      3f / 4f = system gestures                       | |
| |                                                      | |
| |                                                      | |
| +------------------------------------------------------+ |
| +--------------------+----------+---------------------+  |
| |        LEFT        |   MID    |        RIGHT        |  |
| +--------------------+----------+---------------------+  |
+----------------------------------------------------------+
   |<-------------------- 778 px --------------------->|
```

---

## 4. Adaptive breakpoints (Safari, windowed mode, other iPads)

Drive everything from **height**, not from device detection:

| `height` | Rule | Result on iPad 9 |
|---|---|---|
| `≥ 780px` | full landscape layout | standalone: 20 buttons + modifier strip |
| `700–779px` | drop the modifier strip (−76 px), shrink pad to `calc(100% - 74px)`, deck grid loses one row | **Safari landscape (707)**: 16 buttons, pad 549 × 556 |
| `< 700px` | collapse the click row into tap-to-click only; pad takes all remaining height | small windowed PWA |
| `width < 900px` | switch to the portrait stack regardless of orientation | narrow iPadOS 26 window |

```css
.work { display: grid; gap: 20px;
        grid-template-columns: minmax(468px, 556fr) 472fr; }   /* deck right; row-reverse to flip */
@media (max-width: 899px) { .work { grid-template-columns: 1fr; grid-template-rows: 433px 1fr; } }
@media (max-height: 779px) { .modrow { display: none; } }
```

Concrete cost of *not* installing to the home screen, stated plainly for the onboarding copy: **"In Safari you lose 4 deck buttons and the modifier row. Add to Home Screen to get them back."**

---

## 5. How comparable products solve this

| Product | What it gets right | What it gets wrong for a combined screen |
|---|---|---|
| **Stream Deck Mobile 2.0** | First-class iPad app; layouts from 6 keys up to **8 × 8 = 64**, two virtual devices side-by-side for **128 keys**; explicit orientation setting; deliberately oversized keys on large iPads to compensate for no tactile feedback | **No pointer surface at all.** Also gates 8×4/8×8 behind a Pro subscription — the free tier is 6 keys. Multi-instance requires iPad Split View, i.e. it offloads the layout problem to the OS instead of solving it |
| **Touch Portal** | Fully user-defined grid — up to **11 cols × 10 rows = 110 buttons/page**, unlimited pages, user-settable inter-button spacing and page margin. This is the right *model* for your requirement 5/6 | Free tier is 4 × 2. Docs are Windows-centric. 110 buttons on a 10.2" panel would be ~48 px cells — technically HIG-legal, practically unreadable. No trackpad |
| **Unified Remote** | The closest to your product. Ships a genuine multi-touch trackpad (scroll, right-click, drag) **and** 100+ app-specific remotes. Recent iPad redesign added a **sidebar for switching remotes** — "your whole setup, side by side" | Reviews report the trackpad regressed and "works really poorly now"; removing the screen-view feature broke the ability to *see what you're controlling*. The sidebar model still means trackpad and macros are **different screens** — you switch, you don't use both. This is exactly the failure your requirement 7 is written against |
| **Remote Mouse** | Trackpad + a small fixed strip of media/system keys on the same screen | The macro strip is fixed and non-editable — no per-device boards, no catalog |
| **Deckboard** | Simple, low-friction setup; praised as easy to navigate | Network-dependence is its top complaint; no pointer surface |
| **Duet Display** | Its killer feature is the **on-screen Touch Bar replica** — a persistent contextual control strip below a mirrored display. One reviewer picks Duet over Luna purely for it. This validates "control strip + pointing surface coexisting" | It's a display-mirroring product: capped at 1080p, and the whole panel is spent on the mirrored desktop. Latency is its known weak point vs Luna |
| **Luna Display** | Full native Retina resolution on all iPads; **16–32 ms latency over Wi-Fi**, materially better than Duet. Multitouch maps to macOS: tap-select, tap-drag to resize, two-finger scroll, pinch-zoom | Also a mirroring product — zero macro surface. Requires a hardware dongle |

### What this survey actually tells you

1. **Nobody ships a true simultaneous trackpad + macro board.** Unified Remote is the only one with both and it makes you switch screens. This is your differentiation and it justifies the layout complexity.
2. **The winners let the user set grid density.** Touch Portal's user-settable columns/rows/spacing is the feature to copy; your `#cols` slider is already the seed of it. Add rows and gap.
3. **The losers hide capability behind a paywall tier so small it's a demo.** Ship all 20 buttons on day one.
4. **Duet's Touch Bar proves the ergonomic thesis:** a persistent context strip adjacent to a pointing surface is something people will pick a product for.
5. **Latency is the axis on which these products are actually judged.** Luna's 16–32 ms is the bar. On a 60 Hz panel your frame budget is 16.67 ms — coalesce pointer deltas to **one WebSocket send per `requestAnimationFrame`**. Sending faster than 60/s is wasted work on this device (its touch scan is 60 Hz); throttling *below* 60/s is immediately felt. Keep your existing binary `op1` hot path and never let deck rendering share a frame with a pointer send — put the deck grid on its own compositor layer (`contain: layout paint;` `will-change: transform` on pressed cells only).

---

## 6. Touch target sizes for a 132 CSS-ppi panel

Baseline conversion on this device: **1 CSS px = 0.192 mm**.

| Standard | Size | On this iPad |
|---|---|---|
| WCAG 2.2 SC 2.5.8 Target Size (Minimum), **Level AA** | 24 × 24 CSS px | 4.6 × 4.6 mm |
| Apple HIG minimum tappable | 44 × 44 pt = **44 × 44 CSS px** | 8.5 × 8.5 mm |
| WCAG 2.2 SC 2.5.5 Target Size (Enhanced), Level AAA | 44 × 44 CSS px | 8.5 × 8.5 mm |

Apple HIG and WCAG AAA land on the same number here, which makes the rule simple.

### Prescribed sizes for MOUSENDECK

| Element | Size (CSS px) | mm | Ratio to HIG min |
|---|---|---|---|
| Connect / Disconnect pill | **208 × 44** | 40.0 × 8.5 | 1.0× (width 4.7×) |
| Header icon buttons (edit, settings) | **44 × 44** | 8.5 × 8.5 | 1.0× — the floor, nothing smaller |
| Device list row | **380 × 72** | 73 × 13.9 | 1.6× |
| Deck button (default 4-col) | **109 × 109** | 21.0 × 21.0 | **2.5×** |
| Mouse click buttons L / R | **222 × 62** | 42.7 × 11.9 | 1.4× |
| Mouse click button MID | **100 × 62** | 19.2 × 11.9 | 1.4× |
| Modifier keys (⌘ ⌥ ⌃ ⇧) | **80 × 64** | 15.4 × 12.3 | 1.5× |
| Page pill | **44 × 44** hit area, 12 px dot | 8.5 × 8.5 | 1.0× |
| Visual-keyboard key (1u) | **54 × 54** | 10.4 × 10.4 | 1.2× |
| Gesture picker card | **240 × 168** | 46 × 32 | 3.8× |

### Spacing rules

- **Minimum 12 CSS px between any two adjacent interactive elements.** WCAG's spacing exception uses a 24 px-diameter circle centred on each target; a 12 px gap guarantees no circle intersects a neighbour even for the smallest 44 px controls, so you satisfy 2.5.8 by construction.
- Never rely on the WCAG spacing exception to justify sub-44 px targets in this app. These are *repeated, timed, eyes-elsewhere* taps — the failure cost of a mis-tap is executing the wrong macro on a live machine.
- **Expand hit areas beyond the visual box** with a transparent `::before { inset: -8px }` on any control whose painted size is under 44 px (page dots, close buttons). Cheap, invisible, and it converts every borderline control into a pass.
- Set `-webkit-tap-highlight-color: transparent` (you already do) **but then you owe an explicit `:active` state** — with no tactile feedback and a 60 Hz panel, a visual press state inside one frame is the only confirmation the user gets. Your existing `.mbtn.down { transform: scale(.97) }` is the right pattern; apply it to deck buttons too. Consider `navigator.vibrate` — unsupported on iOS; do not rely on it.
- Respect `@media (prefers-reduced-motion: reduce)` on the press animation, and `@media (prefers-contrast: more)` to raise `--line` from `#2a2a38` to something that clears 3:1 against `--panel`.

### Contrast note on your current palette

`--dim: #8a8a9e` on `--bg: #0a0a0f` is roughly 6.5:1 — fine for the 13 px status text. But `--line: #2a2a38` on `--panel: #14141c` is well under 3:1, so your deck button *borders* do not meet WCAG 1.4.11 Non-text Contrast as the sole affordance boundary. Give deck buttons a filled background (`--panel-2`) rather than relying on the hairline border.

---

## 7. Sizing for the two pickers (requirement 9)

### 7.1 Full visual keyboard

Modal content box in landscape: `1080 − 32 (margins) − 40 (modal padding) = 1008 px`.

An ANSI main block is **15u wide** on every row (`13 keys + 2u Backspace`, `1.5u Tab + 12 + 1.5u \`, `1.75u Caps + 11 + 2.25u Enter`, `2.25u Shift + 10 + 2.75u Shift`).

```
unit = 54 px, gap = 5 px
  alpha block   15u  ->  15*54 + 14*5 = 880 px
  gap                                    16 px
  nav column     2u  ->   2*54 +  1*5 = 113 px
                                       -------
                                       1009 px  ~= 1008  ✓

  rows: F-row + 4 alpha rows + space row = 6
        6*54 + 5*5 = 349 px tall

  modal: 56 title + 60 combo preview + 349 keys + 44 segmented + 64 footer + pad ≈ 600 px  <= 706 ✓
```

**54 px keys = 10.4 mm — 1.23× the HIG minimum.** Every key is legal.

A **true 100% keyboard is 23.5u wide** (main 15u + nav 4u + numpad 4u + separators). To fit that in 1008 px you would need `unit ≈ 38 px = 7.3 mm`, which **fails Apple HIG**. Do not scale to fit.

> **Recommendation:** keep the 15u alpha block + 2u nav column always visible at 54 px, and put the F-row, numpad, and media/system keys behind a **segmented control** above the keyboard: `[ Main ] [ Function ] [ Numpad ] [ Media ]`. Alternative if you insist on one continuous 100% board: render at 54 px into a `overflow-x: auto; scroll-snap-type: x mandatory` strip (1382 px, ≈1.37 screens) with snap points at the three blocks. Never shrink below 48 px.

Live combo preview at the top (`⌘ ⇧ 4` rendered as pressed keycaps), modifiers latch as toggles, and the OS badge drives the glyph set (`⌘/⌥/⌃/⇧` for macOS, `Win/Alt/Ctrl/Shift` for Windows) — that's where requirement 4's capability gating surfaces in this UI.

### 7.2 Gesture picker

Same 1008 px content box. **4 columns × 16 px gaps → cards of 240 × 168 px.** Each card carries a small SVG finger diagram + name + resulting action.

Two tabs, driven by the connected device's OS:

- **macOS Multi-Touch set** (verified against Apple's gesture documentation): tap-to-click; secondary click (two-finger); two-finger scroll; pinch/spread zoom; two-finger rotate; two-finger double-tap smart-zoom; two-finger swipe left/right to navigate pages; **two-finger swipe from right edge → Notification Center**; three-finger swipe up → Mission Control; **four-finger swipe up → Mission Control**; **four-finger swipe down → App Exposé**; four-finger swipe left/right → switch full-screen apps/desktops; **thumb + three-finger pinch → Launchpad**; thumb + three-finger spread → Show Desktop; three-finger drag (accessibility setting).
- **Windows Precision Touchpad set** (verified against Microsoft's touchpad-gestures documentation): tap; two-finger tap → right-click; two-finger scroll; pinch zoom; **three-finger tap → Search**; three-finger swipe up → Task View; three-finger swipe down → Show Desktop; three-finger swipe left/right → switch apps; **four-finger tap → Notification Center**; four-finger swipe left/right → switch virtual desktops. Note Windows exposes *Advanced gestures* remapping, so treat 3-/4-finger actions as user-configurable labels, not fixed semantics.

Grey-out is the wrong pattern here — **hide** gestures the target OS cannot perform, per requirement 4. A disabled-looking card invites a tap and produces a dead end.

---

## 8. Direct implications for the existing code

Files at `/Users/satish/Desktop/SKSKNProjects/MOUSENDECK/public/`:

- **`index.html`** — the `<nav id="tabs">` with `Trackpad` / `Deck` buttons must go; that is the Unified Remote mistake. Both panes render simultaneously. Also change `apple-mobile-web-app-status-bar-style` from `black-translucent` to `black`, or keep translucent and apply the `--status-bar: 20px` fix from §1.4.
- **`style.css` line 8–9** — `--pad-top: env(safe-area-inset-top)` evaluates to `0px` on this device. This is the concrete bug described in §1.4.
- **`style.css` line 47** — `.view { position: absolute; inset: 0 }` with `.view.active` is the show/hide-one-pane model. Replace with the CSS grid in §4.
- **`style.css` line 25** — `height: 100dvh` is correct and should stay; add the `--vh` JS fallback from §1.5 for iPadOS 26 windowed mode.
- **`#cols` slider (`min=2 max=8`)** in Settings maps onto §2.4; change default to 4 and add a rows/gap control to match Touch Portal's model.
- **`--line: #2a2a38`** fails non-text contrast as a sole boundary — see §6.

---

## Sources

- [iPad (9th generation) — Technical Specifications, Apple Support](https://support.apple.com/en-us/111898)
- [iPad (9th generation) — Wikipedia](https://en.wikipedia.org/wiki/IPad_(9th_generation))
- [iPad 10.2 viewport size, resolution, PPI, screen specs — YesViz](https://yesviz.com/devices/ipad-10_2-2019/)
- [Issue: window.innerHeight is incorrect in Safari iPhone/iPad — Apple Developer Forums](https://developer.apple.com/forums/thread/735055)
- [iPad Navigation Bar and Toolbar Height Changes in iOS 12 — Geoff Hackworth](https://hacknicity.medium.com/ipad-navigation-bar-and-toolbar-height-changes-in-ios-12-91c5766809f4)
- [Supporting New iPad Pro Models — Use Your Loaf](https://useyourloaf.com/blog/supporting-new-ipad-pro-models/)
- [Using safe-area-inset to build mobile-safe layouts — Polypane](https://polypane.app/blog/using-safe-area-inset-to-build-mobile-safe-layouts/)
- [Adding support for iOS' safe areas in your web app — Jip Frijlink](https://jipfr.nl/blog/supporting-ios-web/)
- [PWA in iPadOS 26 is a joke — DEV Community](https://dev.to/reinhart1010/pwa-in-ipados-26-is-a-joke-38g1)
- [iPad models compatible with iPadOS 26 — Apple Support](https://support.apple.com/guide/ipad/ipad213a25b2/ipados)
- [Understanding SC 2.5.8 Target Size (Minimum) — W3C WAI](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [Stream Deck Mobile 2.0 brings native iPad support — Scoring Notes](https://www.scoringnotes.com/news/stream-deck-mobile-2-0-brings-native-ipad-support-for-the-first-time-and-a-whole-lot-more/)
- [Elgato Stream Deck Mobile 2.0 — How to change Keypad Layout](https://help.elgato.com/hc/en-us/articles/16549072466445-Elgato-Stream-Deck-Mobile-2-0-How-to-change-Keypad-Layout)
- [Unified Remote — App Store](https://apps.apple.com/us/app/unified-remote/id825534179?platform=ipad)
- [Touch Portal — Understanding Pages](https://www.touch-portal.com/blog/post/tutorials/understanding_section_pages.php)
- [Luna Display versus Duet Display — Astropad](https://astropad.com/luna-display-versus-duet-display/)
- [Luna Display Turns Your iPad into a Mac Monitor with Low Latency — Podfeet](https://www.podfeet.com/blog/2018/11/luna-display/)
- [Use Multi-Touch gestures on Mac — Apple Support](https://support.apple.com/en-us/102482)
- [Touchpad gestures for your Windows 11 laptop — Microsoft](https://www.microsoft.com/en-us/windows/learning-center/touchpad-gestures)
- [Touch gestures for Windows — Microsoft Support](https://support.microsoft.com/en-us/windows/hardware/input-devices/touch-gestures-for-windows)