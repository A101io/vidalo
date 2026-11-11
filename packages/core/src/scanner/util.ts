/**
 * Small async utilities: concurrency limiter (p-limit style), retry with
 * backoff, timeouts, seeded PRNG. No external dependencies.
 */

export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

/** p-limit style: at most `concurrency` functions run at once. */
export function createLimiter(concurrency: number): Limiter {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active--;
    const run = queue.shift();
    if (run) run();
  };
  return <T>(fn: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(next);
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Reject if `promise` takes longer than `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = "operation"): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  /** Return false to stop retrying for this error. */
  shouldRetry?: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number) => void;
}

/** Retry `fn` with exponential backoff and jitter. */
export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const baseMs = opts.baseMs ?? 800;
  const maxMs = opts.maxMs ?? 10_000;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt > retries || (opts.shouldRetry && !opts.shouldRetry(err))) throw err;
      opts.onRetry?.(err, attempt);
      const delay = Math.min(maxMs, baseMs * 2 ** (attempt - 1)) * (0.7 + Math.random() * 0.6);
      await sleep(delay);
    }
  }
}

/** FNV-1a 32-bit hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32). Same seed -> same sequence, always. */
export function seededRandom(seed: string | number): () => number {
  let a = typeof seed === "number" ? seed >>> 0 : hashString(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fetch a URL as text with a timeout and a byte cap. Returns null on any failure. */
export async function fetchText(url: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const maxBytes = opts.maxBytes ?? 200_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": "VidaloBot/0.1 (+https://vidalo.ai)", accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
    });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
    }
    reader.cancel().catch(() => undefined);
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, maxBytes);
    return buf.toString("utf8");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Remove every `<tag ...> ... </tag>` block in one pass; an unclosed block drops the rest. Linear (security S-13). */
function dropBlocks(html: string, tag: string): string {
  const lower = html.toLowerCase();
  const open = `<${tag}`;
  const close = `</${tag}`;
  const parts: string[] = [];
  let at = 0;
  for (;;) {
    const start = lower.indexOf(open, at);
    if (start < 0) {
      parts.push(html.slice(at));
      break;
    }
    parts.push(html.slice(at, start), " ");
    const end = lower.indexOf(close, start + open.length);
    if (end < 0) break;
    const gt = lower.indexOf(">", end);
    if (gt < 0) break;
    at = gt + 1;
  }
  return parts.join("");
}

/** Replace every `<...>` by a space in one pass; a `<` with no `>` after it drops the rest. Linear. */
function dropTags(html: string): string {
  const parts: string[] = [];
  let at = 0;
  for (;;) {
    const lt = html.indexOf("<", at);
    if (lt < 0) {
      parts.push(html.slice(at));
      break;
    }
    parts.push(html.slice(at, lt));
    const gt = html.indexOf(">", lt + 1);
    if (gt < 0) break;
    parts.push(" ");
    at = gt + 1;
  }
  return parts.join("");
}

/** Strip tags/scripts from HTML and collapse whitespace. Every step is linear in the input, whatever the markup. */
export function htmlToText(html: string): string {
  const text = dropTags(dropBlocks(dropBlocks(html, "script"), "style").replace(/<br\s{0,20}\/?>|<\/(?:p|div|li|tr|h\d)>/gi, "\n"))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Fetching a page whose address came from outside (the visitor, a search result).
// ---------------------------------------------------------------------------

/** Private, loopback, link-local and other non-public IPv4/IPv6 literals (security S-11). */
function privateAddress(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (h.includes(":")) {
    if (h === "::" || h === "::1") return true;
    const mapped = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return privateAddress(mapped[1]!);
    return /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || /^::ffff:/.test(h);
  }
  // Numeric forms the URL parser already normalised to dotted quads never reach here; hex or decimal hosts are not hosts.
  return /^(?:0x[0-9a-f]+|\d+)$/.test(h);
}

/** An address that may be fetched: http(s) only, no credentials, no internal or private host. */
export function isPublicHttpUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return null;
  if (privateAddress(host)) return null;
  return u;
}

/**
 * Fetch a page as text for a address that someone else chose. Refuses non-http(s) schemes, credentials,
 * internal and private hosts, follows at most three redirects by hand and checks every hop the same way.
 * Returns null on any failure. The cap applies to the bytes read, before anything parses them.
 */
export async function fetchPublicText(url: string, opts: { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch } = {}): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const maxBytes = opts.maxBytes ?? 300_000;
  const doFetch = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let current = isPublicHttpUrl(url);
    for (let hop = 0; current && hop <= 3; hop++) {
      const res = await doFetch(current.toString(), {
        signal: ctrl.signal,
        redirect: "manual",
        headers: { "user-agent": "VidaloBot/0.1 (+https://vidalo.ai)", accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        current = loc ? isPublicHttpUrl(new URL(loc, current).toString()) : null;
        continue;
      }
      if (!res.ok || !res.body) return null;
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < maxBytes) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.byteLength;
      }
      reader.cancel().catch(() => undefined);
      return Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, maxBytes).toString("utf8");
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
