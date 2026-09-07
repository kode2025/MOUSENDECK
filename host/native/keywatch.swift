// Passive listener. Installs a listen-only event tap and prints every arrow
// keystroke it sees, with the full flag word. Nothing is posted, nothing is
// changed — this only reports what the system is being told.
//
// The point: if a synthetic ⌃→ shows up here looking identical to a real one,
// the event is well formed and the Dock is choosing to ignore it. If it looks
// different, the difference IS the bug.
import Foundation
import CoreGraphics

let names: [Int64: String] = [123: "←", 124: "→", 125: "↓", 126: "↑"]

func describe(_ f: CGEventFlags) -> String {
    var parts: [String] = []
    if f.contains(.maskControl)     { parts.append("ctrl") }
    if f.contains(.maskShift)       { parts.append("shift") }
    if f.contains(.maskAlternate)   { parts.append("alt") }
    if f.contains(.maskCommand)     { parts.append("cmd") }
    if f.contains(.maskSecondaryFn) { parts.append("fn") }
    if f.contains(.maskNumericPad)  { parts.append("numpad") }
    if f.contains(.maskHelp)        { parts.append("help") }
    if f.contains(.maskAlphaShift)  { parts.append("caps") }
    return parts.isEmpty ? "(none)" : parts.joined(separator: "+")
}

let cb: CGEventTapCallBack = { _, type, event, _ in
    guard type == .keyDown else { return Unmanaged.passUnretained(event) }
    let code = event.getIntegerValueField(.keyboardEventKeycode)
    guard let name = names[code] else { return Unmanaged.passUnretained(event) }
    let src = event.getIntegerValueField(.eventSourceStateID)
    let pid = event.getIntegerValueField(.eventSourceUnixProcessID)
    print("  \(name)  flags=0x\(String(event.flags.rawValue, radix: 16))  [\(describe(event.flags))]  srcState=\(src) pid=\(pid)")
    fflush(stdout)
    return Unmanaged.passUnretained(event)
}

guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
                                  options: .listenOnly,
                                  eventsOfInterest: CGEventMask(1 << CGEventType.keyDown.rawValue),
                                  callback: cb, userInfo: nil) else {
    FileHandle.standardError.write("keywatch: could not create the tap (Accessibility?)\n".data(using: .utf8)!)
    exit(1)
}
let rl = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), rl, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
print("  watching arrow keys — nothing is being posted")
fflush(stdout)
CFRunLoopRun()
