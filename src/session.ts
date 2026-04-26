// Pull Facebook cookies from the real Chrome profile and apply them to
// playwright's persistent context. Uses macOS Keychain to decrypt.
import { Database } from 'bun:sqlite';
import { execSync } from 'node:child_process';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { BrowserContext } from 'playwright';
import { ROOT, log } from './lib';

const CHROME_BASE = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
const COOKIES_OUT = path.join(ROOT, '.fb-cookies.json');

type FbCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
};

function chromeProfileCookiesFile(profile: string): string {
  // Newer Chrome versions store cookies in Network/Cookies; older in Cookies
  const newPath = path.join(CHROME_BASE, profile, 'Network', 'Cookies');
  const oldPath = path.join(CHROME_BASE, profile, 'Cookies');
  if (existsSync(newPath)) return newPath;
  return oldPath;
}

export function findActiveChromeProfile(): string {
  // Pick the Chrome profile whose Cookies file was modified most recently.
  // Falls back to "Default" if nothing matches.
  if (!existsSync(CHROME_BASE)) return 'Default';
  const dirs = readdirSync(CHROME_BASE, { withFileTypes: true })
    .filter((d) => d.isDirectory() && (d.name === 'Default' || /^Profile \d+$/.test(d.name)))
    .map((d) => d.name);
  let best: { name: string; mtime: number } | null = null;
  for (const name of dirs) {
    const cookies = chromeProfileCookiesFile(name);
    if (!existsSync(cookies)) continue;
    const mtime = statSync(cookies).mtimeMs;
    if (!best || mtime > best.mtime) best = { name, mtime };
  }
  return best?.name ?? 'Default';
}

function getChromeMacOSKey(): Buffer {
  // The Chrome Safe Storage password is stored in the user's keychain.
  // first time this runs, macOS will prompt the user for permission.
  let pwd: string;
  try {
    pwd = execSync('security find-generic-password -wgs "Chrome Safe Storage" -a "Chrome" 2>/dev/null', {
      encoding: 'utf8',
    }).trim();
  } catch {
    throw new Error(
      'could not access Chrome Safe Storage in your keychain. macOS will prompt for permission the first time. retry after allowing.'
    );
  }
  if (!pwd) throw new Error('empty Chrome keychain password');
  return pbkdf2Sync(pwd, 'saltysalt', 1003, 16, 'sha1');
}

function decrypt(encrypted: Buffer, key: Buffer): string {
  if (encrypted.length === 0) return '';
  const prefix = encrypted.subarray(0, 3).toString();
  if (prefix !== 'v10' && prefix !== 'v11') {
    return encrypted.toString('utf8'); // unencrypted (rare)
  }
  const ciphertext = encrypted.subarray(3);
  const iv = Buffer.alloc(16, 0x20); // 16 spaces
  const decipher = createDecipheriv('aes-128-cbc', key, iv);
  const out = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  // chrome 120+ prepends 32-byte SHA256 of host_key for integrity; strip it
  // we cannot tell from length alone, but a heuristic: if the first 32 bytes
  // contain non-printable chars and the rest is printable, strip 32.
  // Simpler: try the full string, if invalid utf-8, try minus 32.
  const full = out.toString('utf8');
  if (full.length > 32 && /[\x00-\x08\x0e-\x1f]/.test(full.slice(0, 32))) {
    return out.subarray(32).toString('utf8');
  }
  return full;
}

function chromeUtcToUnixSec(chromeUtc: number): number {
  if (chromeUtc <= 0) return -1;
  return Math.floor(chromeUtc / 1_000_000 - 11_644_473_600);
}

const SAMESITE_MAP: Record<number, FbCookie['sameSite']> = {
  [-1]: 'None',
  [0]: 'None',
  [1]: 'Lax',
  [2]: 'Strict',
};

export function syncFromChrome(profile: string = 'Default'): FbCookie[] {
  const src = chromeProfileCookiesFile(profile);
  if (!existsSync(src)) {
    throw new Error(`Chrome cookies file not found: ${src}`);
  }
  const tmp = '/tmp/arb-chrome-cookies.db';
  copyFileSync(src, tmp);

  const db = new Database(tmp, { readonly: true });
  const rows = db
    .prepare(
      `SELECT host_key, name, encrypted_value, expires_utc, path, is_secure, is_httponly, samesite
       FROM cookies
       WHERE host_key LIKE '%facebook.com' OR host_key LIKE '%messenger.com' OR host_key LIKE '%fbcdn.net'`
    )
    .all() as any[];

  if (!rows.length) {
    throw new Error('no facebook cookies in your Chrome profile. are you logged in to facebook in Chrome?');
  }

  const key = getChromeMacOSKey();
  const out: FbCookie[] = [];
  for (const r of rows) {
    try {
      const value = decrypt(Buffer.from(r.encrypted_value), key);
      out.push({
        name: r.name,
        value,
        domain: r.host_key,
        path: r.path || '/',
        expires: chromeUtcToUnixSec(r.expires_utc),
        httpOnly: !!r.is_httponly,
        secure: !!r.is_secure,
        sameSite: SAMESITE_MAP[r.samesite] ?? 'None',
      });
    } catch (e: any) {
      log(`× skip cookie ${r.host_key} ${r.name}: ${e.message}`);
    }
  }
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(COOKIES_OUT, JSON.stringify(out, null, 2));
  log(`✓ synced ${out.length} cookies to ${COOKIES_OUT}`);
  return out;
}

export async function applyToContext(ctx: BrowserContext): Promise<boolean> {
  if (!existsSync(COOKIES_OUT)) return false;
  const cookies = JSON.parse(readFileSync(COOKIES_OUT, 'utf8')) as FbCookie[];
  // playwright requires either {url} or {domain, path}; we have the latter.
  await ctx.addCookies(cookies as any);
  return true;
}

export function summarize(): { total: number; key_session_cookies: string[] } | null {
  if (!existsSync(COOKIES_OUT)) return null;
  const cookies = JSON.parse(readFileSync(COOKIES_OUT, 'utf8')) as FbCookie[];
  const wanted = ['c_user', 'xs', 'fr', 'datr', 'sb', 'm_pixel_ratio', 'wd'];
  const have = cookies.map((c) => c.name).filter((n) => wanted.includes(n));
  return { total: cookies.length, key_session_cookies: [...new Set(have)] };
}
