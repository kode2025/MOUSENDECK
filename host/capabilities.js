// What this host can actually do.
//
// The client uses this to filter the shortcut catalog, so the user is never
// offered a button the target machine cannot perform. Advertised in the
// Bonjour TXT record and sent in full on connect.

import { platform, release } from 'node:os';

/**
 * Which OS this host actually is, rather than an assertion that it is a Mac.
 *
 * The client picks its shortcut vocabulary from this, so a hardcoded 'macos'
 * meant the Windows catalog could never be chosen automatically no matter what
 * machine was running the server. It is still true that only macOS can inject
 * input today — see the note on `actions` below — but the honest answer to
 * "what am I connected to" is measured, not assumed.
 */
function hostOS() {
  switch (platform()) {
    case 'darwin': return 'macos';
    case 'win32': return 'windows';
    case 'linux': return 'linux';
    default: return platform();
  }
}

// Gestures are the honest part of this file.
//
// macOS will NOT let a synthesised event impersonate a real multi-touch
// gesture: swipes, pinch, rotate and force-click are interpreted by the window
// server from raw trackpad data, and CGEventPost cannot produce them. What we
// CAN do is send the keyboard shortcut that produces the same visible result.
// So each gesture is tagged with how it is delivered:
//   native  — genuinely synthesised as a real input event
//   mapped  — delivered as an equivalent keyboard shortcut
//   none    — not achievable; never offered in the UI
export const MACOS_GESTURES = [
  { id: 'tap1',        label: 'One-finger tap',        mode: 'native', does: 'Left click' },
  { id: 'tap2',        label: 'Two-finger tap',        mode: 'native', does: 'Right click' },
  { id: 'tap3',        label: 'Three-finger tap',      mode: 'native', does: 'Middle click' },
  { id: 'drag1',       label: 'One-finger drag',       mode: 'native', does: 'Move pointer' },
  { id: 'tapdrag',     label: 'Tap then drag',         mode: 'native', does: 'Click and drag' },
  { id: 'scroll2',     label: 'Two-finger scroll',     mode: 'native', does: 'Scroll' },
  { id: 'doubletap',   label: 'Double tap',            mode: 'native', does: 'Double click' },

  { id: 'swipe3up',    label: 'Three-finger swipe up',    mode: 'mapped', key: 'up',    mods: ['ctrl'],        does: 'Mission Control' },
  { id: 'swipe3down',  label: 'Three-finger swipe down',  mode: 'mapped', key: 'down',  mods: ['ctrl'],        does: 'App Windows' },
  { id: 'swipe3left',  label: 'Three-finger swipe left',  mode: 'mapped', key: 'left',  mods: ['ctrl'],        does: 'Previous Space' },
  { id: 'swipe3right', label: 'Three-finger swipe right', mode: 'mapped', key: 'right', mods: ['ctrl'],        does: 'Next Space' },
  { id: 'pinchopen',   label: 'Pinch out',                mode: 'mapped', key: '=',     mods: ['cmd'],         does: 'Zoom in' },
  { id: 'pinchclose',  label: 'Pinch in',                 mode: 'mapped', key: '-',     mods: ['cmd'],         does: 'Zoom out' },
  { id: 'spread',      label: 'Spread thumb + 3 fingers', mode: 'mapped', key: 'f11',   mods: [],              does: 'Show Desktop' },
  { id: 'pinch4',      label: 'Pinch four fingers',       mode: 'mapped', key: 'space', mods: ['cmd', 'alt'],  does: 'Launchpad' },

  { id: 'rotate',      label: 'Two-finger rotate', mode: 'none', why: 'No CGEvent equivalent; app-specific.' },
  { id: 'forceclick',  label: 'Force click',       mode: 'none', why: 'Requires real pressure data from the trackpad hardware.' },
  { id: 'edge',        label: 'Edge swipe',        mode: 'none', why: 'Consumed by the window server before any synthetic event.' },
];

// Kept alongside macOS so the client can render the Windows gesture set in the
// picker. Delivery is via keyboard equivalents for the same reason.
export const WINDOWS_GESTURES = [
  { id: 'tap1',        label: 'One-finger tap',           mode: 'native', does: 'Left click' },
  { id: 'tap2',        label: 'Two-finger tap',           mode: 'native', does: 'Right click' },
  { id: 'tap3',        label: 'Three-finger tap',         mode: 'mapped', key: 's',   mods: ['win'],  does: 'Search' },
  { id: 'tap4',        label: 'Four-finger tap',          mode: 'mapped', key: 'a',   mods: ['win'],  does: 'Action Centre' },
  { id: 'drag1',       label: 'One-finger drag',          mode: 'native', does: 'Move pointer' },
  { id: 'scroll2',     label: 'Two-finger scroll',        mode: 'native', does: 'Scroll' },
  { id: 'doubletap',   label: 'Double tap',               mode: 'native', does: 'Double click' },
  { id: 'swipe3up',    label: 'Three-finger swipe up',    mode: 'mapped', key: 'tab', mods: ['win'],  does: 'Task View' },
  { id: 'swipe3down',  label: 'Three-finger swipe down',  mode: 'mapped', key: 'd',   mods: ['win'],  does: 'Show Desktop' },
  { id: 'swipe3left',  label: 'Three-finger swipe left',  mode: 'mapped', key: 'tab', mods: ['alt'],  does: 'Previous app' },
  { id: 'swipe3right', label: 'Three-finger swipe right', mode: 'mapped', key: 'tab', mods: ['alt'],  does: 'Next app' },
  { id: 'swipe4left',  label: 'Four-finger swipe left',   mode: 'mapped', key: 'left',  mods: ['win', 'ctrl'], does: 'Previous desktop' },
  { id: 'swipe4right', label: 'Four-finger swipe right',  mode: 'mapped', key: 'right', mods: ['win', 'ctrl'], does: 'Next desktop' },
  { id: 'pinchopen',   label: 'Pinch out',                mode: 'mapped', key: '=',   mods: ['ctrl'], does: 'Zoom in' },
  { id: 'pinchclose',  label: 'Pinch in',                 mode: 'mapped', key: '-',   mods: ['ctrl'], does: 'Zoom out' },
  { id: 'rotate',      label: 'Two-finger rotate',        mode: 'none', why: 'App-specific; no system equivalent.' },
];

export function capabilities() {
  return {
    os: hostOS(),
    osVersion: release(),
    // Action types host/actions.js can execute.
    actions: ['key', 'text', 'media', 'mouse', 'scroll', 'open', 'shell', 'terminal', 'applescript', 'multi', 'delay'],
    modifiers: ['cmd', 'shift', 'alt', 'ctrl', 'fn'],
    mediaKeys: [
      'playpause', 'next', 'prev', 'soundup', 'sounddown', 'mute',
      'brightnessup', 'brightnessdown', 'illuminationup', 'illuminationdown',
    ],
    gestures: MACOS_GESTURES,
  };
}

/** Compact form for the Bonjour TXT record, which is size-limited. */
export function capsSummary() {
  return capabilities().actions.join(',');
}
