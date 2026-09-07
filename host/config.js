// Config load/save.
//
// Each host owns its identity and its own board, so a board travels with the
// machine it drives: connect the iPad to this Mac and you get this Mac's
// buttons. The iPad only remembers which devices it has connected to.

import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Two files on purpose:
//   config.json — holds the auth token, so it stays out of git
//   board.json  — your buttons, kept readable and safe to commit or copy
const CONFIG_PATH = join(ROOT, 'config.json');
const BOARD_PATH = join(ROOT, 'board.json');

function machineName() {
  try {
    return execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8' }).trim();
  } catch {
    return hostname().replace(/\.local$/, '');
  }
}

/**
 * A short, stable, non-secret tag for this machine — "K4M9".
 *
 * Two laptops can easily share a name ("MacBook Pro"), so the picker needs
 * something unambiguous to search on. Derived from the hardware UUID, which
 * survives renames and reinstalls; hashed so the raw UUID never leaves the
 * machine. Base32 without vowels or look-alike characters, so it cannot spell
 * anything and cannot be misread over a desk.
 */
export function machineTag() {
  let seed;
  try {
    seed = execFileSync('/bin/sh', ['-c',
      "ioreg -rd1 -c IOPlatformExpertDevice | awk -F'\"' '/IOPlatformUUID/{print $4}'"],
      { encoding: 'utf8' }).trim();
  } catch {
    seed = '';
  }
  if (!seed) seed = `${machineName()}:${hostname()}`;

  const digest = createHash('sha256').update(`mousendeck:${seed}`).digest();
  const ALPHABET = '0123456789BCDFGHJKLMNPQRSTVWXYZ';
  let tag = '';
  for (let i = 0; i < 4; i++) tag += ALPHABET[digest[i] % ALPHABET.length];
  return tag;
}

const btn = (label, icon, color, action, builtin) => ({
  id: randomBytes(6).toString('hex'), label, icon, color, action, builtin,
});

/** Buttons a fresh board starts with. Every one is re-addable from the
 *  catalog after deletion, so `builtin` records where it came from. */
export function starterButtons() {
  return [
    btn('Copy', '⧉', '#3b82f6', { type: 'key', key: 'c', mods: ['cmd'] }, 'edit.copy'),
    btn('Paste', '⇩', '#3b82f6', { type: 'key', key: 'v', mods: ['cmd'] }, 'edit.paste'),
    btn('Undo', '⤺', '#6366f1', { type: 'key', key: 'z', mods: ['cmd'] }, 'edit.undo'),
    btn('Redo', '⤻', '#6366f1', { type: 'key', key: 'z', mods: ['cmd', 'shift'] }, 'edit.redo'),
    btn('Prev', '⏮', '#8b5cf6', { type: 'media', k: 'prev' }, 'media.prev'),
    btn('Play', '⏯', '#8b5cf6', { type: 'media', k: 'playpause' }, 'media.playpause'),
    btn('Next', '⏭', '#8b5cf6', { type: 'media', k: 'next' }, 'media.next'),
    btn('Mute', '🔇', '#8b5cf6', { type: 'media', k: 'mute' }, 'media.mute'),
    btn('Vol −', '🔉', '#0ea5e9', { type: 'media', k: 'sounddown' }, 'media.voldown'),
    btn('Vol +', '🔊', '#0ea5e9', { type: 'media', k: 'soundup' }, 'media.volup'),
    btn('Mission', '▦', '#14b8a6', { type: 'key', key: 'up', mods: ['ctrl'] }, 'window.mission'),
    btn('Spotlight', '🔍', '#14b8a6', { type: 'key', key: 'space', mods: ['cmd'] }, 'system.spotlight'),
    // Capture: an area snip and a whole-screen shot are different jobs often
    // wanted back to back, and a recording you cannot stop from the deck is a
    // trap — so Stop ships alongside the two Record buttons.
    btn('Snip', '📸', '#f59e0b', { type: 'key', key: '4', mods: ['cmd', 'shift'] }, 'shot.area'),
    btn('Full Shot', '🖼', '#f59e0b', { type: 'key', key: '3', mods: ['cmd', 'shift'] }, 'shot.full'),
    btn('Rec Screen', '⏺', '#ef4444',
      { type: 'shell', cmd: 'screencapture -v "$HOME/Desktop/Recording-$(date +%Y-%m-%d-%H%M%S).mov"' },
      'rec.screen'),
    btn('Rec Area', '⏹', '#ef4444',
      { type: 'shell', cmd: 'screencapture -J video "$HOME/Desktop/Recording-$(date +%Y-%m-%d-%H%M%S).mov"' },
      'rec.area'),
    btn('Stop Rec', '⏏', '#ef4444',
      { type: 'shell', cmd: 'pkill -INT screencapture' },
      'rec.stop'),
    btn('Lock', '🔒', '#ef4444', { type: 'key', key: 'q', mods: ['cmd', 'ctrl'] }, 'system.lock'),
    btn('Finder', '📁', '#22c55e', { type: 'open', target: '~' }, 'app.finder'),
    btn('Browser', '🌐', '#22c55e', { type: 'open', target: 'Safari' }, 'app.safari'),
  ];
}

export function defaultConfig() {
  return {
    port: 8787,
    token: randomBytes(16).toString('hex'),
    identity: { name: machineName(), tag: machineTag() },
    // Which shortcut vocabulary the board is written in.
    platform: 'macos',
    // Trackpad on the left instead of the right.
    lefty: false,
    // Custom shortcuts you have built, kept as a library so they can be added
    // to any board — not just the one they were created on.
    customs: [],
    pointer: {
      sensitivity: 1.8,
      acceleration: 1.6,
      naturalScroll: true,
      scrollSpeed: 1.0,
      tapToClick: true,
      // Air pointer: pixels of cursor travel per degree the phone is turned.
      airSpeed: 25,
      airInvert: false,
    },
    board: {
      columns: 5,
      pages: [{ name: 'Main', buttons: starterButtons() }],
    },
  };
}

/** Fill in anything a hand-edited or older config.json is missing. */
function merge(base, saved) {
  const out = { ...base, ...saved };
  // Name is yours to change; the tag is derived from the hardware, so a stale
  // one in config.json must never win.
  out.identity = { ...base.identity, ...(saved.identity || {}), tag: base.identity.tag };
  out.pointer = { ...base.pointer, ...(saved.pointer || {}) };

  // v1 called this `deck`; carry those boards forward rather than losing them.
  const board = saved.board || saved.deck || base.board;
  out.board = { ...base.board, ...board };
  delete out.deck;

  if (!Array.isArray(out.board.pages) || out.board.pages.length === 0) {
    out.board.pages = base.board.pages;
  }
  for (const page of out.board.pages) {
    page.buttons = (page.buttons || []).map((b) => ({
      ...b,
      id: b.id || randomBytes(6).toString('hex'),
    }));
  }
  return out;
}

export function loadConfig() {
  const base = defaultConfig();

  let cfg = base;
  if (existsSync(CONFIG_PATH)) {
    try {
      cfg = merge(base, JSON.parse(readFileSync(CONFIG_PATH, 'utf8')));
    } catch (err) {
      console.error(`  config.json is unreadable (${err.message}); using defaults.`);
    }
  }

  // The board lives in its own file so you can read, edit, diff and commit it
  // without the token riding along.
  if (existsSync(BOARD_PATH)) {
    try {
      const saved = JSON.parse(readFileSync(BOARD_PATH, 'utf8'));
      if (Array.isArray(saved?.customs)) cfg.customs = saved.customs;
      if (Array.isArray(saved?.pages) && saved.pages.length) {
        const { customs: _c, ...boardOnly } = saved;
        cfg.board = { ...base.board, ...boardOnly };
        for (const page of cfg.board.pages) {
          page.buttons = (page.buttons || []).map((b) => ({
            ...b,
            id: b.id || randomBytes(6).toString('hex'),
          }));
        }
      }
    } catch (err) {
      console.error(`  board.json is unreadable (${err.message}); keeping the default board.`);
    }
  }

  saveConfig(cfg);
  return cfg;
}

/** Write to a temp file first so a crash mid-write can't shred your board. */
function writeAtomic(path, data) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export function saveConfig(cfg) {
  const { board, customs, ...rest } = cfg;
  writeAtomic(CONFIG_PATH, JSON.stringify(rest, null, 2));
  // Your buttons and your custom shortcuts travel together, and neither
  // contains a secret, so both live in the readable file.
  writeAtomic(BOARD_PATH, JSON.stringify({ ...board, customs: customs || [] }, null, 2));
}

export { CONFIG_PATH, BOARD_PATH, ROOT };
