import { NextResponse } from "next/server";
import { copyFor } from "@vidalo/core/copy";
import { COMING_SOON_ROUTE } from "@vidalo/core/shared/gate";
import { WAITLIST_EVENT, WAITLIST_PER_HOUR, WAITLIST_PER_IP, WAITLIST_WINDOW_MS, makeLimiter, parseWaitlist } from "@vidalo/core/shared";
import { ready } from "@/lib/db";
import { env } from "@/lib/env";
import { localizeHref } from "@/lib/lang-paths";

export const runtime = "nodejs";

const limited = makeLimiter(WAITLIST_PER_IP, WAITLIST_WINDOW_MS);

/** The form only ever posts from our own pages; anything else is turned away before it is read. */
function fromOwnSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // some browsers omit it on same-origin form posts
  try {
    const host = new URL(origin).host;
    return host === new URL(env.baseUrl).host || host === new URL(req.url).host;
  } catch {
    return false;
  }
}

/**
 * POST email + consent (+ lang, + the hidden `website` trap) from /binnenkort
 * → one row in `waitlist` (migration 0007), then back to the page with
 * ?lijst=ok | fout | druk | mislukt. The answer for a new address and for one
 * already on the list is the same "ok", so the form cannot be used to find
 * out who signed up. The address never goes into the event log or the server
 * log; the stored consent is the server's own sentence in that language.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const parsed = parseWaitlist({
    email: form?.get("email"),
    consent: form?.get("consent"),
    lang: form?.get("lang"),
    website: form?.get("website"),
  });
  const lang = parsed.language;
  const back = (state: "ok" | "fout" | "druk" | "mislukt") =>
    NextResponse.redirect(`${env.baseUrl}${localizeHref(COMING_SOON_ROUTE, lang)}?lijst=${state}#lijst`, 303);

  if (!form || !fromOwnSite(req)) return back("mislukt");
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limited(ip)) return back("druk");
  if (!parsed.ok) return back(parsed.reason === "trap" ? "ok" : "fout");

  try {
    const db = await ready();
    if ((await db.countEventsSince(WAITLIST_EVENT, new Date(Date.now() - 60 * 60 * 1000))) >= WAITLIST_PER_HOUR) return back("druk");
    const { created } = await db.joinWaitlist({
      email: parsed.email,
      language: lang,
      source: "coming_soon",
      consentText: copyFor(lang).comingSoon.list.consent,
    });
    await db.logEvent(null, WAITLIST_EVENT, { language: lang, created });
    return back("ok");
  } catch (err) {
    console.error("waitlist.failed", { message: err instanceof Error ? err.message.replace(/\S+@\S+/g, "<email>") : "unknown" });
    return back("mislukt");
  }
}
