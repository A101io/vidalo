/**
 * The coming-soon list (/binnenkort, EN /coming-soon): what a sign-up must
 * look like before it reaches the database (migration 0007). Pure, so the
 * route stays thin and every rule has a test.
 *
 * The rules, in order:
 *  - `website` is a field hidden from people; a bot that fills it is told
 *    "thanks" and nothing is stored (outcome "trap").
 *  - the consent box must be ticked; the stored consent text is the
 *    server's own sentence, never anything the browser sends.
 *  - the address is trimmed and lower-cased, at most 254 characters, one @,
 *    a dot in the domain, no spaces or control characters.
 */
export type WaitlistLang = "nl" | "en";

export type WaitlistParse =
  | { ok: true; email: string; language: WaitlistLang }
  | { ok: false; reason: "trap" | "no_consent" | "invalid"; language: WaitlistLang };

export interface WaitlistFields {
  email?: unknown;
  consent?: unknown;
  lang?: unknown;
  website?: unknown;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export function normalizeEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

export function isListEmail(email: string): boolean {
  return email.length >= 6 && email.length <= 254 && !CONTROL.test(email) && EMAIL.test(email);
}

export function parseWaitlist(f: WaitlistFields): WaitlistParse {
  const language: WaitlistLang = String(f.lang ?? "") === "en" ? "en" : "nl";
  if (String(f.website ?? "").trim() !== "") return { ok: false, reason: "trap", language };
  if (String(f.consent ?? "") !== "ja") return { ok: false, reason: "no_consent", language };
  const email = normalizeEmail(f.email);
  if (!isListEmail(email)) return { ok: false, reason: "invalid", language };
  return { ok: true, email, language };
}

/** Per address: at most this many sign-up attempts per window, per isolate. */
export const WAITLIST_PER_IP = 5;
export const WAITLIST_WINDOW_MS = 10 * 60 * 1000;
/** Site-wide: new rows per hour before the form says "busy". A flood stops here, not in the table. */
export const WAITLIST_PER_HOUR = 300;
/** The event logged per accepted sign-up (language and whether it was new; never the address). */
export const WAITLIST_EVENT = "waitlist.joined";

/** A sliding-window counter per key. Returns true when the key is over the limit. */
export function makeLimiter(perWindow: number, windowMs: number, maxKeys = 5000) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()): boolean => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > maxKeys) hits.clear();
    return recent.length > perWindow;
  };
}
