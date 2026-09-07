// Executes deck button actions. Anything that isn't a raw input event
// (launching apps, shell, AppleScript) is handled here rather than in Swift.
//
// Every runner reports back. A button that silently does nothing is worse than
// one that fails loudly: the tile still pulses green, so you assume the Mac got
// it and go looking for the problem somewhere else. `runAction` resolves to
// { ok } or { ok:false, error } and the server relays that to the device.

import { execFile, spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { send } from './input.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OK = { ok: true };
const fail = (error) => ({ ok: false, error });

/** macOS says "Not authorized to send Apple events" when the app running this
 *  server has not been granted Automation for the target. It is a different
 *  permission from Accessibility and a different prompt, so name it plainly
 *  rather than passing the raw osascript text through. */
function readableError(raw) {
  const s = String(raw || '').trim();
  if (/-1743|not authoriz/i.test(s)) {
    const app = s.match(/application "([^"]+)"/)?.[1] || 'that app';
    return `macOS is blocking control of ${app}. Grant your Terminal `
         + `"Automation" in System Settings › Privacy & Security › Automation.`;
  }
  if (/-1728|Can’t get|Can't get/i.test(s)) return `The script ran but the app did not understand it.`;
  if (/screen record|TCC|not permitted/i.test(s)) {
    return `macOS is blocking screen recording. Grant your Terminal "Screen & System `
         + `Audio Recording" in System Settings › Privacy & Security, then run `
         + `disconnect and connect again.`;
  }
  if (/not found|No such file/i.test(s)) return s.replace(/^.*?:\s*/, '');
  // Long enough for a permission fix or a setup instruction to survive intact;
  // truncating those to a fragment is the same as not reporting them. Empty in
  // means empty out, so the caller can fall back to something more specific
  // than a bare "failed".
  return s.split('\n')[0].slice(0, 400);
}

/** `open` handles apps, URLs, files and folders — pick the right flag.
 *  Deliberately not AppleScript: `open` needs no Automation permission. */
function runOpen(target) {
  let t = String(target || '').trim();
  if (!t) return Promise.resolve(fail('nothing to open'));
  const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(mailto|tel|facetime):/i.test(t);
  const isPath = t.startsWith('/') || t.startsWith('~') || t.startsWith('.');
  // execFile runs no shell, so a leading ~ would be handed to `open` verbatim
  // and resolved against the working directory. Expand it here.
  if (t === '~' || t.startsWith('~/')) t = homedir() + t.slice(1);
  const args = isUrl || isPath ? [t] : ['-a', t];

  return new Promise((resolve) => {
    execFile('open', args, (err, _out, stderr) => {
      if (!err) return resolve(OK);
      const msg = /Unable to find application/i.test(stderr || '')
        ? `${t} is not installed on this Mac.`
        : (readableError(stderr || err.message) || 'could not open it');
      console.error(`[action] open ${t}: ${msg}`);
      resolve(fail(msg));
    });
  });
}

// Long enough to catch a command that fails immediately (a missing Shortcut
// errors in well under this), short enough that a screen recording — which by
// design runs until you stop it — is reported as started, not hung.
const SHELL_VERDICT_MS = 1200;

function runShell(cmd) {
  if (!cmd?.trim()) return Promise.resolve(fail('empty command'));

  return new Promise((resolve) => {
    // Detached so a long-running command outlives the button press.
    const p = spawn('/bin/zsh', ['-lc', cmd], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };

    p.stderr?.on('data', (d) => { stderr += d; });
    p.on('error', (err) => done(fail(readableError(err.message) || 'could not start')));
    // 'close', not 'exit': 'exit' fires as soon as the process ends, which can
    // beat the last chunk of piped stderr and lose the very message we are
    // trying to report. 'close' waits for the streams too.
    p.on('close', (code) => {
      if (code === 0) return done(OK);
      const msg = readableError(stderr) || `exited with code ${code}`;
      console.error(`[action] shell: ${msg}`);
      done(fail(msg));
    });

    // Still running when the clock runs out: that is a success for anything
    // that is *meant* to keep running.
    setTimeout(() => { p.unref(); done(OK); }, SHELL_VERDICT_MS);
  });
}

// MARK: - Run in Terminal
//
// `shell` runs detached with its output going nowhere, which is right for
// `pmset sleepnow` and useless for `npm run dev` — you want the window, the
// log, and the ability to Ctrl-C it.
//
// The obvious route is AppleScript (`tell application "Terminal" to do
// script …`), and it is the wrong one: driving another app that way needs
// Automation permission, which is the exact trap the Finder button fell into.
// Writing an executable .command file and handing it to `open` needs no
// permission at all — macOS runs .command files in Terminal by definition.

const SCRIPT_DIR = join(tmpdir(), 'mousendeck');

/** Filesystem-safe stem for the script, because Terminal titles the window
 *  after the file — "Dev server" reads better than "tmp-8f2a1c". */
function scriptName(title, cmd) {
  const base = String(title || cmd || 'command').trim().split(/\s+/).slice(0, 4).join(' ');
  return (base.replace(/[^\w .-]/g, '').slice(0, 40) || 'command');
}

/** Old scripts pile up in tmp otherwise. An hour is long enough that nothing
 *  still opening can have its file pulled out from under it. */
function sweepOldScripts() {
  try {
    const cutoff = Date.now() - 3600_000;
    for (const f of readdirSync(SCRIPT_DIR)) {
      const p = join(SCRIPT_DIR, f);
      if (statSync(p).mtimeMs < cutoff) rmSync(p, { force: true });
    }
  } catch { /* nothing to sweep */ }
}

function runTerminal(action) {
  const cmd = String(action.cmd || '').trim();
  if (!cmd) return Promise.resolve(fail('nothing to run'));

  let dir = String(action.dir || '').trim();
  if (dir === '~' || dir.startsWith('~/')) dir = homedir() + dir.slice(1);

  const body = [
    '#!/bin/zsh',
    // The window should say what it is before anything scrolls past.
    `printf '\\033]0;%s\\007' ${JSON.stringify(scriptName(action.title, cmd))}`,
    dir ? `cd ${JSON.stringify(dir)} || { echo "no such folder: ${dir}" >&2; exit 1; }` : '',
    cmd,
    '',
  ].filter(Boolean).join('\n');

  try {
    mkdirSync(SCRIPT_DIR, { recursive: true });
    sweepOldScripts();
    // Same name for the same button, so pressing it twice does not litter.
    const file = join(SCRIPT_DIR, `${scriptName(action.title, cmd)}.command`);
    writeFileSync(file, body, { mode: 0o700 });

    return new Promise((resolve) => {
      const args = action.app ? ['-a', action.app, file] : ['-a', 'Terminal', file];
      execFile('open', args, (err, _out, stderr) => {
        if (!err) return resolve(OK);
        const msg = /Unable to find application/i.test(stderr || '')
          ? `${action.app} is not installed on this Mac.`
          : (readableError(stderr || err.message) || 'could not open a terminal');
        console.error(`[action] terminal: ${msg}`);
        resolve(fail(msg));
      });
    });
  } catch (err) {
    return Promise.resolve(fail(`could not write the script — ${err.message}`));
  }
}

function runAppleScript(script) {
  if (!script?.trim()) return Promise.resolve(fail('empty script'));
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], (err, _out, stderr) => {
      if (!err) return resolve(OK);
      const msg = readableError(stderr || err.message) || 'the script failed';
      console.error(`[action] applescript: ${msg}`);
      resolve(fail(msg));
    });
  });
}

export async function runAction(action) {
  if (!action || typeof action !== 'object') return fail('no action');

  switch (action.type) {
    case 'key':
      send({ t: 'key', key: action.key, mods: action.mods || [] });
      return OK;

    case 'text':
      send({ t: 'text', s: action.s ?? '' });
      return OK;

    case 'media':
      send({ t: 'media', k: action.k });
      return OK;

    case 'mouse':
      send({ t: 'click', b: action.b || 'left', n: action.n || 1 });
      return OK;

    case 'scroll':
      send({ t: 'scroll', dx: action.dx || 0, dy: action.dy || 0 });
      return OK;

    case 'open':        return runOpen(action.target);
    case 'shell':       return runShell(action.cmd);
    case 'terminal':    return runTerminal(action);
    case 'applescript': return runAppleScript(action.script);

    case 'delay':
      await sleep(Math.min(action.ms || 0, 10000));
      return OK;

    case 'multi': {
      // Stop at the first step that fails, and say which one — "step 2 of 3"
      // localises the problem far faster than a generic failure.
      const steps = action.steps || [];
      for (let i = 0; i < steps.length; i++) {
        const r = await runAction(steps[i]);
        if (!r.ok) return fail(`step ${i + 1} of ${steps.length}: ${r.error}`);
        await sleep(steps[i].after ?? 40);
      }
      return OK;
    }

    default:
      console.error(`[action] unknown type '${action.type}'`);
      return fail(`unknown action type '${action.type}'`);
  }
}
