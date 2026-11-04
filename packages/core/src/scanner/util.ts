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

/** A name with a dot that is not localhost or an IP literal. */
export function isPublicHostname(host: string): boolean {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return false; // also rejects IPv4/IPv6 literals and bare names
  return !/(^|\.)(localhost|local|internal)$/i.test(host);
}

/** An http(s) URL on a public hostname, without credentials: the only kind the worker fetches for a third party. */
export function isFetchableUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password && isPublicHostname(u.hostname);
}

export const MAX_REDIRECTS = 5;

/**
 * fetch() for URLs that come from outside (a Places website, an AI answer's
 * citation, an owner's domain): every hop, redirects included, must pass
 * isFetchableUrl, and at most MAX_REDIRECTS are followed. Throws on a refused
 * URL, like fetch throws on a network error.
 */
export async function fetchPublic(url: string, init: RequestInit = {}, fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = fetch): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isFetchableUrl(current)) throw new Error(`refused url: ${current.slice(0, 200)}`);
    const res = await fetchImpl(current, { ...init, redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    current = new URL(location, current).toString();
  }
  throw new Error(`too many redirects: ${url.slice(0, 200)}`);
}

/** Fetch a URL as text with a timeout and a byte cap. Returns null on any failure, a refused URL included. */
export async function fetchText(url: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const maxBytes = opts.maxBytes ?? 200_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchPublic(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "VidaloBot/0.1 (+https://vidalo.io)", accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
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

/** Strip tags/scripts from HTML and collapse whitespace. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/tr>|<\/h\d>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}
