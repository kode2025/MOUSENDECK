// mdinput — MOUSENDECK input injector for macOS
//
// Reads newline-delimited JSON commands on stdin and synthesizes system-wide
// mouse/keyboard events via Quartz Event Services (CGEvent).
//
// Kept as a separate process from the Node host on purpose: this is the only
// binary that needs Accessibility permission, and it has zero dependencies.

import Foundation
import AppKit
import CoreGraphics

// MARK: - Event source

let src = CGEventSource(stateID: .hidSystemState)

/// Union of all active displays, in CG global space (top-left origin).
func desktopBounds() -> CGRect {
    var count: UInt32 = 0
    CGGetActiveDisplayList(0, nil, &count)
    guard count > 0 else { return CGRect(x: 0, y: 0, width: 1920, height: 1080) }
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
    CGGetActiveDisplayList(count, &ids, &count)
    var r = CGDisplayBounds(ids[0])
    for id in ids.dropFirst() { r = r.union(CGDisplayBounds(id)) }
    return r
}

var bounds = desktopBounds()

// MARK: - Pointer state

var cursor: CGPoint = CGEvent(source: nil)?.location ?? .zero
var leftDown = false
var rightDown = false

func clamp(_ p: CGPoint) -> CGPoint {
    CGPoint(x: min(max(p.x, bounds.minX), bounds.maxX - 1),
            y: min(max(p.y, bounds.minY), bounds.maxY - 1))
}

/// Re-sync with the real cursor. The user may have moved the physical mouse
/// since our last event, so we must not drift away from the true position.
func syncCursor() {
    if let p = CGEvent(source: nil)?.location { cursor = p }
}

func postMouse(_ type: CGEventType, _ button: CGMouseButton, dx: Double = 0, dy: Double = 0, clicks: Int64 = 1) {
    guard let ev = CGEvent(mouseEventSource: src, mouseType: type,
                           mouseCursorPosition: cursor, mouseButton: button) else { return }
    // Games and some UIs read deltas rather than absolute position.
    ev.setIntegerValueField(.mouseEventDeltaX, value: Int64(dx.rounded()))
    ev.setIntegerValueField(.mouseEventDeltaY, value: Int64(dy.rounded()))
    if clicks > 1 { ev.setIntegerValueField(.mouseEventClickState, value: clicks) }
    ev.post(tap: .cghidEventTap)
}

var lastMoveAt: CFAbsoluteTime = 0

func moveBy(dx: Double, dy: Double) {
    // Re-anchor to the real pointer only when the stream has been idle.
    //
    // Syncing on every packet compounds macOS's own pointer acceleration: the
    // OS nudges the cursor slightly past where we placed it, the next packet
    // reads that overshot position and adds to it, and a fast swipe ends up
    // travelling twice as far as it should. Between gestures we still resync,
    // so moving the physical mouse is picked up.
    let now = CFAbsoluteTimeGetCurrent()
    if now - lastMoveAt > 0.25 { syncCursor() }
    lastMoveAt = now

    cursor = clamp(CGPoint(x: cursor.x + dx, y: cursor.y + dy))
    if leftDown       { postMouse(.leftMouseDragged, .left, dx: dx, dy: dy) }
    else if rightDown { postMouse(.rightMouseDragged, .right, dx: dx, dy: dy) }
    else              { postMouse(.mouseMoved, .left, dx: dx, dy: dy) }
}

func moveTo(x: Double, y: Double) {
    let target = clamp(CGPoint(x: bounds.minX + x * bounds.width,
                               y: bounds.minY + y * bounds.height))
    let dx = target.x - cursor.x, dy = target.y - cursor.y
    cursor = target
    if leftDown { postMouse(.leftMouseDragged, .left, dx: dx, dy: dy) }
    else        { postMouse(.mouseMoved, .left, dx: dx, dy: dy) }
}

func buttonFor(_ name: String) -> (CGMouseButton, CGEventType, CGEventType) {
    switch name {
    case "right":  return (.right, .rightMouseDown, .rightMouseUp)
    case "middle": return (.center, .otherMouseDown, .otherMouseUp)
    default:       return (.left, .leftMouseDown, .leftMouseUp)
    }
}

func mouseDown(_ name: String, clicks: Int64 = 1) {
    syncCursor()
    let (btn, down, _) = buttonFor(name)
    if name == "right" { rightDown = true } else if name != "middle" { leftDown = true }
    postMouse(down, btn, clicks: clicks)
}

func mouseUp(_ name: String, clicks: Int64 = 1) {
    syncCursor()
    let (btn, _, up) = buttonFor(name)
    if name == "right" { rightDown = false } else if name != "middle" { leftDown = false }
    postMouse(up, btn, clicks: clicks)
}

func click(_ name: String, count: Int64 = 1) {
    for i in 1...max(1, count) {
        mouseDown(name, clicks: i)
        mouseUp(name, clicks: i)
    }
}

func scroll(dx: Double, dy: Double) {
    guard let ev = CGEvent(scrollWheelEvent2Source: src, units: .pixel,
                           wheelCount: 2, wheel1: Int32(dy.rounded()),
                           wheel2: Int32(dx.rounded()), wheel3: 0) else { return }
    ev.post(tap: .cghidEventTap)
}

// MARK: - Keyboard

let keyCodes: [String: CGKeyCode] = [
    "a":0,"s":1,"d":2,"f":3,"h":4,"g":5,"z":6,"x":7,"c":8,"v":9,"b":11,"q":12,
    "w":13,"e":14,"r":15,"y":16,"t":17,"1":18,"2":19,"3":20,"4":21,"6":22,"5":23,
    "=":24,"9":25,"7":26,"-":27,"8":28,"0":29,"]":30,"o":31,"u":32,"[":33,"i":34,
    "p":35,"l":37,"j":38,"'":39,"k":40,";":41,"\\":42,",":43,"/":44,"n":45,"m":46,
    ".":47,"`":50,
    "return":36,"enter":36,"tab":48,"space":49,"delete":51,"backspace":51,
    "escape":53,"esc":53,
    "capslock":57,
    "volumeup":72,"volumedown":73,"mute":74,
    "keypadenter":76,
    "f1":122,"f2":120,"f3":99,"f4":118,"f5":96,"f6":97,"f7":98,"f8":100,"f9":101,
    "f10":109,"f11":103,"f12":111,"f13":105,"f14":107,"f15":113,"f16":106,
    "f17":64,"f18":79,"f19":80,
    "help":114,"home":115,"pageup":116,"forwarddelete":117,"end":119,"pagedown":121,
    "left":123,"right":124,"down":125,"up":126,
]

func flagFor(_ mod: String) -> CGEventFlags {
    switch mod.lowercased() {
    case "cmd", "command", "meta": return .maskCommand
    case "shift":                  return .maskShift
    case "alt", "option", "opt":   return .maskAlternate
    case "ctrl", "control":        return .maskControl
    case "fn", "function":         return .maskSecondaryFn
    default:                       return []
    }
}

/// The virtual key code of each modifier, so it can be pressed for real
/// rather than merely asserted as a flag. Left-hand variants, which is what
/// a keyboard sends unless you deliberately use the right-hand key.
let modKeyCodes: [String: CGKeyCode] = [
    "cmd": 55, "command": 55, "meta": 55,
    "shift": 56,
    "alt": 58, "option": 58, "opt": 58,
    "ctrl": 59, "control": 59,
    "fn": 63, "function": 63,
]

func flags(from mods: [String]) -> CGEventFlags {
    var f = CGEventFlags()
    for m in mods { f.insert(flagFor(m)) }
    return f
}

/// The four arrow keys, which macOS treats as part of the numeric keypad.
///
/// This is not a quirk of ours — on real hardware the arrows are reported in
/// the keypad group of the HID descriptor, so every genuine arrow keystroke
/// arrives with NX_NUMERICPADMASK set. The system hotkey layer that owns
/// Mission Control and Spaces matches on the WHOLE flag set, so a synthetic
/// ⌃← without that bit never matches the registered hotkey and silently does
/// nothing.
///
/// The confusing part, and why this took finding: the same event works fine
/// for moving a text cursor, because an app just reads the key code and does
/// not care about the flag. So arrows appear to work everywhere except the
/// one place you were using them — switching desktops.
let arrowKeyCodes: Set<CGKeyCode> = [123, 124, 125, 126]   // left right down up

func pressKey(_ key: String, mods: [String]) {
    guard let code = keyCodes[key.lowercased()] else {
        FileHandle.standardError.write("mdinput: unknown key '\(key)'\n".data(using: .utf8)!)
        return
    }
    var f = flags(from: mods)
    if arrowKeyCodes.contains(code) { f.insert(.maskNumericPad) }

    // Build the events BEFORE touching any modifier, so a failure here can
    // never leave Control stuck down on someone's Mac.
    guard let down = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: true),
          let up   = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: false)
    else { return }

    // Press the modifiers for real, rather than only asserting them as flags.
    //
    // Setting .flags is enough for an ordinary application shortcut: the app
    // reads the flags off the event and acts. It is NOT enough for the
    // system hotkeys owned by the WindowServer — switching Spaces, Mission
    // Control — which track the actual modifier key state coming off the HID
    // stream. A ⌃← carrying the control FLAG but with no control key ever
    // held looks like nothing was pressed, and is ignored in silence.
    //
    // So do what hardware does: hold the modifier, tap the key, release it.
    let modCodes = mods.compactMap { modKeyCodes[$0.lowercased()] }
    var running = CGEventFlags()
    for m in mods {
        guard let mc = modKeyCodes[m.lowercased()] else { continue }
        running.insert(flagFor(m))
        if let md = CGEvent(keyboardEventSource: src, virtualKey: mc, keyDown: true) {
            md.flags = running
            md.post(tap: .cghidEventTap)
        }
    }

    down.flags = f
    up.flags = f
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)

    // Release in reverse, unwinding the flag set the same way it was built.
    // Unconditional: whatever happened above, the keyboard ends up idle.
    for m in mods.reversed() {
        guard let mc = modKeyCodes[m.lowercased()] else { continue }
        running.remove(flagFor(m))
        if let mu = CGEvent(keyboardEventSource: src, virtualKey: mc, keyDown: false) {
            mu.flags = running
            mu.post(tap: .cghidEventTap)
        }
    }
    _ = modCodes
}

/// Type arbitrary text, including characters with no dedicated key code.
func typeText(_ s: String) {
    for chunk in Array(s).chunked(into: 16) {
        let str = String(chunk)
        guard let down = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true),
              let up   = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false)
        else { continue }
        var utf16 = Array(str.utf16)
        down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
        up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
        usleep(1500)
    }
}

extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map { Array(self[$0 ..< Swift.min($0 + size, count)]) }
    }
}

// MARK: - Media / hardware keys
// These ride on NSEvent's systemDefined channel, not the normal key path.

let mediaKeys: [String: Int32] = [
    "soundup": 0, "sounddown": 1, "mute": 7,
    "brightnessup": 2, "brightnessdown": 3,
    "playpause": 16, "next": 19, "prev": 20, "fast": 19, "rewind": 20,
    "illuminationup": 21, "illuminationdown": 22,
]

func pressMedia(_ name: String) {
    guard let code = mediaKeys[name.lowercased()] else {
        FileHandle.standardError.write("mdinput: unknown media key '\(name)'\n".data(using: .utf8)!)
        return
    }
    for isDown in [true, false] {
        let data1 = Int((code << 16) | ((isDown ? 0xA : 0xB) << 8))
        guard let ev = NSEvent.otherEvent(with: .systemDefined,
                                          location: .zero, modifierFlags: [],
                                          timestamp: 0, windowNumber: 0, context: nil,
                                          subtype: 8, data1: data1, data2: -1)
        else { continue }
        ev.cgEvent?.post(tap: .cghidEventTap)
    }
}

// MARK: - Permission

func checkAccessibility(prompt: Bool) -> Bool {
    let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
    return AXIsProcessTrustedWithOptions(opts)
}

// MARK: - Command dispatch

func num(_ v: Any?) -> Double {
    if let d = v as? Double { return d }
    if let i = v as? Int { return Double(i) }
    if let s = v as? String { return Double(s) ?? 0 }
    return 0
}

func handle(_ cmd: [String: Any]) {
    guard let t = cmd["t"] as? String else { return }
    switch t {
    case "move":   moveBy(dx: num(cmd["dx"]), dy: num(cmd["dy"]))
    case "moveto": moveTo(x: num(cmd["x"]), y: num(cmd["y"]))
    case "down":   mouseDown((cmd["b"] as? String) ?? "left")
    case "up":     mouseUp((cmd["b"] as? String) ?? "left")
    case "click":  click((cmd["b"] as? String) ?? "left", count: Int64(num(cmd["n"]) == 0 ? 1 : num(cmd["n"])))
    case "scroll": scroll(dx: num(cmd["dx"]), dy: num(cmd["dy"]))
    case "key":    pressKey((cmd["key"] as? String) ?? "", mods: (cmd["mods"] as? [String]) ?? [])
    case "text":   typeText((cmd["s"] as? String) ?? "")
    case "media":  pressMedia((cmd["k"] as? String) ?? "")
    case "displays": bounds = desktopBounds()
    case "ping":
        FileHandle.standardOutput.write("{\"t\":\"pong\"}\n".data(using: .utf8)!)
    case "where":
        // Self-reported position: lets a test measure a move without a second
        // process racing the user's own hand on the trackpad.
        syncCursor()
        let b = desktopBounds()
        let msg = "{\"t\":\"where\",\"x\":\(Int(cursor.x)),\"y\":\(Int(cursor.y)),\"w\":\(Int(b.width)),\"h\":\(Int(b.height))}\n"
        FileHandle.standardOutput.write(msg.data(using: .utf8)!)
    default:
        FileHandle.standardError.write("mdinput: unknown command '\(t)'\n".data(using: .utf8)!)
    }
}

// MARK: - Main

// `--check` lets the Node host verify permission before accepting clients.
if CommandLine.arguments.contains("--check") {
    let ok = checkAccessibility(prompt: CommandLine.arguments.contains("--prompt"))
    print(ok ? "trusted" : "untrusted")
    exit(ok ? 0 : 1)
}

if !checkAccessibility(prompt: true) {
    FileHandle.standardError.write(
        "mdinput: Accessibility permission not granted. Grant it in System Settings > Privacy & Security > Accessibility, then restart.\n"
            .data(using: .utf8)!)
}

setvbuf(stdout, nil, _IOLBF, 0)

// Re-read display geometry when monitors are plugged/unplugged.
NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
                                       object: nil, queue: nil) { _ in
    bounds = desktopBounds()
}

/// Line reader over raw stdin that can also answer "is another complete line
/// ALREADY waiting?" without blocking.
///
/// That question is the entire reason this exists. Swift's readLine() can only
/// block for the next line, so the old loop had no way to know that six more
/// moves were sitting in the pipe behind the one it was holding — it posted
/// each of them as its own CGEvent. A post costs about 125 µs, so a burst of
/// six drained in series and the last one landed roughly 750 µs late, with the
/// cursor stepping through every intermediate position on the way.
final class LineReader {
    private var buf = [UInt8]()
    private var chunk = [UInt8](repeating: 0, count: 1 << 16)
    private var eof = false

    /// True when a whole line is already in memory, so merging it in costs
    /// nothing and delays nothing.
    var hasBufferedLine: Bool { buf.firstIndex(of: 0x0A) != nil }

    private func takeBufferedLine() -> [UInt8]? {
        guard let i = buf.firstIndex(of: 0x0A) else { return nil }
        let line = Array(buf[..<i])
        buf.removeFirst(i + 1)
        return line
    }

    /// Blocks until a line is available; nil at end of stream.
    func next() -> [UInt8]? {
        while true {
            if let line = takeBufferedLine() { return line }
            if eof {
                if buf.isEmpty { return nil }
                let rest = buf; buf.removeAll(); return rest
            }
            let n = chunk.withUnsafeMutableBytes { read(0, $0.baseAddress, 1 << 16) }
            if n > 0 { buf.append(contentsOf: chunk[0..<n]) }
            else if n == 0 { eof = true }
            else if errno != EINTR { eof = true }
        }
    }
}

// Motion waiting to be posted. Deltas are additive, so merging a run of them
// is exact — the cursor lands in precisely the same place, in one event
// instead of several, and it lands sooner.
private enum PendingKind { case none, move, scroll }
private var pendingKind: PendingKind = .none
private var pendingDX = 0.0
private var pendingDY = 0.0

private func flushPending() {
    switch pendingKind {
    case .move:   moveBy(dx: pendingDX, dy: pendingDY)
    case .scroll: scroll(dx: pendingDX, dy: pendingDY)
    case .none:   break
    }
    pendingKind = .none; pendingDX = 0; pendingDY = 0
}

let reader = LineReader()

while let line = reader.next() {
    guard !line.isEmpty else { continue }
    guard let obj = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
          let t = obj["t"] as? String else { continue }

    if t == "move" || t == "scroll" {
        let kind: PendingKind = (t == "move") ? .move : .scroll
        // Never merge across kinds: move,scroll,move must stay in that order.
        if pendingKind != kind { flushPending() }
        pendingKind = kind
        pendingDX += num(obj["dx"])
        pendingDY += num(obj["dy"])
        // Only hold it if the next one is already here. With nothing waiting
        // this posts immediately, so coalescing can never ADD latency — it
        // only ever removes the queue behind a burst.
        if reader.hasBufferedLine { continue }
        flushPending()
        continue
    }

    // A click must not overtake the motion that was meant to precede it.
    flushPending()
    handle(obj)
}
flushPending()
