/**
 * The free check asks for an e-mail address before anything runs (decided
 * 9 Nov 2026): the report goes there when the scan is done, so a visitor who
 * closes the tab or switches language still has it, and the address is where
 * the account later lives. Pure, so /api/scan stays thin and every rule has
 * a test.
 *
 *  - the address is trimmed and lower-cased and must look like one
 *    (same rules as the coming-soon list);
 *  - "news about Vidalo" is a separate box, off by default. A free check is
 *    not a purchase, so marketing mail needs this consent (art. 11.7
 *    Telecommunicatiewet); the report mail and the two reminders about the
 *    outcome do not. What is stored is the server's own sentence, never
 *    anything the browser sends.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { isListEmail, normalizeEmail } from "./waitlist.js";

export type FreeCheckLang = "nl" | "en";

/** Event per accepted request, on the business: who asked, in which language, and whether they want news. */
export const REPORT_EMAIL_EVENT = "report_email.requested";
/** Event per ticked news box, on the business: the address and the sentence it agreed to. */
export const MARKETING_CONSENT_EVENT = "marketing.consented";

export const MARKETING_CONSENT_TEXT: Record<FreeCheckLang, string> = {
  nl: "Ik wil af en toe nieuws over Vidalo ontvangen. Afmelden kan in elke mail.",
  en: "I would like to receive occasional news about Vidalo. Every email has an unsubscribe link.",
};

export type FreeCheckRequest = { ok: true; email: string; marketing: boolean } | { ok: false; reason: "invalid" };

export function parseFreeCheckRequest(f: { email?: unknown; marketing?: unknown }): FreeCheckRequest {
  const email = normalizeEmail(f.email);
  if (!isListEmail(email)) return { ok: false, reason: "invalid" };
  return { ok: true, email, marketing: String(f.marketing ?? "") === "ja" };
}

/** What a passed request stores, as the payloads of the two events. */
export function freeCheckEvents(r: { email: string; marketing: boolean }, lang: FreeCheckLang): { type: string; payload: Record<string, unknown> }[] {
  const out: { type: string; payload: Record<string, unknown> }[] = [{ type: REPORT_EMAIL_EVENT, payload: { email: r.email, lang, marketing: r.marketing, via: "check" } }];
  if (r.marketing) out.push({ type: MARKETING_CONSENT_EVENT, payload: { email: r.email, lang, text: MARKETING_CONSENT_TEXT[lang] } });
  return out;
}

/** The address (and language) that last asked for a report on this business, from its events; null when nobody did. */
export function requesterFromEvents(events: { type: string; payload: Record<string, unknown> }[]): { email: string; lang: FreeCheckLang } | null {
  const ev = events.find((e) => e.type === REPORT_EMAIL_EVENT && typeof e.payload.email === "string");
  return ev ? { email: String(ev.payload.email), lang: ev.payload.lang === "en" ? "en" : "nl" } : null;
}

/**
 * Between the form and the pick page (/scan/kies) the address travels in a
 * short-lived, signed, httpOnly cookie, never in the URL (URLs end up in logs
 * and referers). The pick page's forms post it back; /api/scan reads the
 * cookie when the post carries no address.
 */
export const CHECK_COOKIE_TTL_MS = 15 * 60 * 1000;

function checkSig(secret: string, body: string): string {
  return createHmac("sha256", secret).update(`check\n${body}`).digest("base64url");
}

export function signCheckCookie(secret: string, r: { email: string; marketing: boolean }, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ e: r.email, m: r.marketing, x: now + CHECK_COOKIE_TTL_MS })).toString("base64url");
  return `${body}.${checkSig(secret, body)}`;
}

export function readCheckCookie(secret: string, value: unknown, now = Date.now()): { email: string; marketing: boolean } | null {
  if (typeof value !== "string") return null;
  const [body, sig, extra] = value.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = Buffer.from(checkSig(secret, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as { e?: unknown; m?: unknown; x?: unknown };
    if (typeof p.e !== "string" || typeof p.x !== "number" || p.x < now || p.x > now + CHECK_COOKIE_TTL_MS) return null;
    const parsed = parseFreeCheckRequest({ email: p.e, marketing: p.m === true ? "ja" : "" });
    return parsed.ok ? { email: parsed.email, marketing: parsed.marketing } : null;
  } catch {
    return null;
  }
}

/** A request without a run id (made before 11 Nov 2026) matches the run that started this soon after it. */
export const REQUEST_TO_RUN_MS = 60 * 60 * 1000;

/**
 * Which free runs a requester asked for: the run id on their request when it carries one,
 * else the run that started within REQUEST_TO_RUN_MS after it. Never another requester's
 * later run of the same business (compliance and security review, 11 Nov 2026).
 */
export function runsRequested(
  requests: { businessId: string | null; at: string; payload: Record<string, unknown> }[],
  runsOf: (businessId: string) => { id: string; kind: string; status: string; startedAt?: string | null; finishedAt?: string | null }[],
  opts: { now: number; maxAgeDays: number },
): { businessId: string; runId: string; checkedAt: string }[] {
  const since = opts.now - opts.maxAgeDays * 86_400_000;
  const out = new Map<string, { businessId: string; runId: string; checkedAt: string }>();
  for (const e of requests) {
    if (!e.businessId) continue;
    const asked = new Date(e.at).getTime();
    const linked = typeof e.payload.scanRunId === "string" ? e.payload.scanRunId : null;
    for (const run of runsOf(e.businessId)) {
      const at = run.finishedAt ?? run.startedAt;
      if (run.status !== "done" || run.kind !== "free" || !at || new Date(at).getTime() < since) continue;
      const started = new Date(run.startedAt ?? at).getTime();
      const mine = linked ? run.id === linked : started >= asked && started - asked <= REQUEST_TO_RUN_MS;
      if (mine) out.set(run.id, { businessId: e.businessId, runId: run.id, checkedAt: at });
    }
  }
  return [...out.values()].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
}
