// Self-signed certificate for HTTPS on the LAN.
//
// This exists for one reason: iOS will not give a web page the gyroscope
// unless the page is a *secure context*. Not "unless you ask nicely" — the
// motion events simply never fire over plain http, and no client code gets
// around it. So the air-mouse costs an HTTPS server, and on a LAN address
// there is no certificate authority that will vouch for you.
//
// The result is a certificate the phone does not trust, and a warning screen
// you tap through once per device. That is the honest price, and it is why
// HTTPS is the default; `connect --plain` opts out.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';

const DIR = join(ROOT, 'certs');
const KEY = join(DIR, 'key.pem');
const CRT = join(DIR, 'cert.pem');
const MANIFEST = join(DIR, 'names.json');

/** Every name and address this certificate should be valid for. A cert that
 *  does not cover the address you actually type still works — you are tapping
 *  past the warning anyway — but matching keeps the warning to one screen
 *  instead of two. */
function sanList(names) {
  // `DNS:x,IP:y` — the numbered `DNS.1=x` spelling is only valid inside a
  // config-file section, and openssl rejects it in an inline -addext.
  return names
    .map((n) => (/^\d+\.\d+\.\d+\.\d+$/.test(n) ? `IP:${n}` : `DNS:${n}`))
    .join(',');
}

/** Regenerate when the machine's addresses have changed, so the cert keeps
 *  matching after a move between Wi-Fi and a hotspot. */
function upToDate(names) {
  if (!existsSync(KEY) || !existsSync(CRT) || !existsSync(MANIFEST)) return false;
  try {
    const had = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    return names.every((n) => had.includes(n));
  } catch {
    return false;
  }
}

/**
 * Returns { key, cert } PEM buffers, generating them if needed.
 * Throws with a readable message if openssl is missing.
 */
export function ensureCert(names) {
  const all = [...new Set(['localhost', '127.0.0.1', ...names])].filter(Boolean);
  if (upToDate(all)) return { key: readFileSync(KEY), cert: readFileSync(CRT), generated: false };

  mkdirSync(DIR, { recursive: true });
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', KEY, '-out', CRT,
      // 825 days is the maximum Apple platforms accept for a leaf certificate.
      '-days', '825', '-sha256',
      '-subj', '/CN=MouseNDeck',
      '-addext', `subjectAltName=${sanList(all)}`,
      '-addext', 'basicConstraints=critical,CA:FALSE',
      '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment',
      '-addext', 'extendedKeyUsage=serverAuth',
    ], { stdio: 'pipe' });
  } catch (err) {
    const detail = err.stderr?.toString().trim().split('\n').pop() || err.message;
    throw new Error(`could not create a certificate with openssl — ${detail}`);
  }

  writeFileSync(MANIFEST, JSON.stringify(all, null, 2));
  return { key: readFileSync(KEY), cert: readFileSync(CRT), generated: true };
}

export const CERT_DIR = DIR;
