import { cloudflareBindings } from "@/lib/cloudflare";
import { NextResponse, after } from "next/server";
import { copyFor } from "@vidalo/core/copy";
import { localizeHref } from "@/lib/lang-paths";
import { langFromReferer } from "@/lib/request-lang";
import { env } from "@/lib/env";
import { ready } from "@/lib/db";
import { resolveBusiness, prepareBusiness, parseQuery, createScanState, startFreeScan, FREE_SCAN_ENGINES, type BusinessCandidate } from "@/lib/core";
import { requestBehindGate } from "@/lib/gate-state";
import { FREE_SCANS_PER_IP, TURNSTILE_FIELD, clientIp, dayStart, parseTypedWebsite, scanIpEvent, typedBusinessProblem } from "@vidalo/core/shared";
import { passesTurnstile, kiesToken } from "@/lib/turnstile";
import { CHECK_COOKIE, CHECK_COOKIE_OPTIONS, checkCookieValue, checkFromCookie } from "@/lib/free-check";
import { freeCheckEvents, parseFreeCheckRequest, REPORT_EMAIL_EVENT } from "@vidalo/core/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

async function readInput(req: Request): Promise<{ q: string; pick: number | null; place: string | null; form: FormData; email: unknown; marketing: unknown; website: unknown }> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = (await req.json()) as { q?: string; pick?: number; place?: string; email?: string; marketing?: string; website?: string; [TURNSTILE_FIELD]?: string };
    const form = new FormData();
    if (typeof body[TURNSTILE_FIELD] === "string") form.set(TURNSTILE_FIELD, body[TURNSTILE_FIELD]);
    return { q: String(body.q ?? "").trim(), pick: typeof body.pick === "number" ? body.pick : null, place: body.place?.trim() || null, form, email: body.email, marketing: body.marketing, website: body.website };
  }
  const form = await req.formData();
  const pick = form.get("pick");
  const place = String(form.get("place") ?? "").trim();
  return { q: String(form.get("q") ?? "").trim(), pick: pick != null && pick !== "" ? Number(pick) : null, place: place || null, form, email: form.get("email"), marketing: form.get("marketing"), website: form.get("website") };
}

/**
 * POST /api/scan  (q=<name or website>, email=<address>[, marketing=ja][, place=<plaats>][, pick=<candidate index>][, website=<own website>])
 * Resolves the business; with several candidates (or none / no place) redirects to
 * /scan/kies; otherwise prepares business + provisional facts + prompts, records who
 * asked (the report is mailed there when the scan is done), starts the free scan after
 * the response and redirects to the waiting room /scan/[token]. Without an address
 * nothing runs (shared/free-check.ts); between the form and the pick page the address
 * rides in the signed cookie, not in the URL.
 */
export async function POST(req: Request) {
  const lang = langFromReferer(req);
  // Redirects land on pages in the language the form was posted from.
  const base = env.baseUrl;
  const to = (path: string) => `${base}${localizeHref(path, lang)}`;
  // While the launch gate is on, only a browser with the preview cookie may start a check.
  // The gate hides the scan form, but a direct POST would otherwise still spend engine and
  // Places calls before launch. Checked before anything else, the lookup included.
  if (requestBehindGate(req)) return NextResponse.redirect(to("/binnenkort"), 303);
  const { q, pick, place: placeInput, form, email, marketing, website } = await readInput(req);
  const copy = copyFor(lang);
  if (!q) return NextResponse.redirect(to("/?fout=leeg#controle"), 303);
  // Length and markup limits on what was typed, before anything that costs money (security S-04). The place can ride in the name ("Sonable, Rotterdam").
  if (typedBusinessProblem(q, placeInput ?? parseQuery(q).place)) return NextResponse.redirect(to("/?fout=leeg#controle"), 303);
  // The address: from this post, or from the cookie the first post set (the pick page's forms carry none).
  const asked = email != null && String(email).trim() !== "" ? parseFreeCheckRequest({ email, marketing }) : null;
  const requester = asked?.ok ? asked : asked === null ? checkFromCookie(req) : null;
  // No usable address: back to the field, before the bot check and the lookup (nothing spent).
  if (!requester) {
    const p = placeInput ?? parseQuery(q).place;
    return NextResponse.redirect(to(`/scan/kies?q=${encodeURIComponent(q)}${p ? `&place=${encodeURIComponent(p)}` : ""}&fout=mail`), 303);
  }
  // Bot check before the Places lookup: every post past this line can cost money.
  if (!(await passesTurnstile(form, clientIp(req)))) return NextResponse.redirect(to("/scan/druk?check=1"), 303);
  await ready();

  const parsed = parseQuery(q);
  const place = placeInput ?? parsed.place;
  const candidates = await resolveBusiness(parsed.query, place);
  // The pick page looks the business up again; the token says this visitor passed the check.
  const k = kiesToken(q, place ?? "");
  const kies = to(`/scan/kies?q=${encodeURIComponent(q)}${place ? `&place=${encodeURIComponent(place)}` : ""}${k ? `&k=${encodeURIComponent(k)}` : ""}`);
  // The pick page keeps the address in the cookie; its forms post without one.
  const withCookie = (res: NextResponse) => {
    res.cookies.set(CHECK_COOKIE, checkCookieValue(requester), CHECK_COOKIE_OPTIONS);
    return res;
  };
  if (candidates.length === 0) return withCookie(NextResponse.redirect(kies, 303));

  let candidate: BusinessCandidate | undefined;
  if (candidates.length === 1) candidate = candidates[0];
  else if (pick != null && candidates[pick]) candidate = candidates[pick];
  if (!candidate) return withCookie(NextResponse.redirect(kies, 303));
  // A business Google does not list: the website is asked for on /scan/kies (ADR-0007), the only place it is. A first post (no pick) goes there.
  const unlisted = !candidate.placeId && !candidate.website;
  if (unlisted && pick == null) return withCookie(NextResponse.redirect(kies, 303));
  // What the visitor typed is checked here, before anything is stored or fetched; a refusal goes back next to the field and the value is never echoed.
  let typedWebsite: string | null = null;
  if (unlisted) {
    const parsed = parseTypedWebsite(website);
    if (!parsed.ok) return withCookie(NextResponse.redirect(`${kies}&fout=website&kandidaat=${pick ?? 0}`, 303));
    typedWebsite = parsed.url;
  }
  const finalPlace = candidate.place ?? place;
  if (!finalPlace) return withCookie(NextResponse.redirect(`${kies}&plaats=1`, 303));

  const db = await ready();
  const dayAgo = new Date(Date.now() - DAY_MS);
  if (env.realEngines && (await db.countEventsSince("scan.requested", dayAgo)) >= env.freeScansPerDay) {
    await db.logEvent(null, "scan.refused", { reason: "daily_cap", cap: env.freeScansPerDay });
    return NextResponse.redirect(to("/scan/druk"), 303);
  }

  const { business, created } = await prepareBusiness({ name: candidate.name, place: finalPlace, candidate, website: typedWebsite });

  // Who asked, and whether they want news: on the business, never as its owner (an address proves nothing).
  // The address is done travelling: the cookie goes.
  const done = (res: NextResponse) => {
    res.cookies.set(CHECK_COOKIE, "", { ...CHECK_COOKIE_OPTIONS, maxAge: 0 });
    return res;
  };
  const alreadyAsked = (await db.listEvents(business.id, 500)).some((e) => e.type === REPORT_EMAIL_EVENT && e.payload.email === requester.email);
  for (const ev of freeCheckEvents(requester, lang)) await db.logEvent(business.id, ev.type, ev.payload);

  // Asked again within a day: show the report we already paid for, and mail it to a new asker.
  const recent = (await db.listScanRuns(business.id, 5)).find((r) => r.kind === "free" && r.status === "done" && r.finishedAt && new Date(r.finishedAt) >= dayAgo);
  if (recent) {
    await db.logEvent(business.id, "scan.reused", { scanRunId: recent.id, via: "web" });
    if (!business.ownerEmail && !alreadyAsked) await db.enqueueJob("email", { template: "baseline", scanRunId: recent.id, businessId: business.id, to: requester.email, lang });
    // The reused report is this address's too (the signed-in page lists it).
    await db.logEvent(business.id, REPORT_EMAIL_EVENT, { email: requester.email, lang, scanRunId: recent.id, via: "linked" });
    return done(NextResponse.redirect(to(`/r/${recent.id}`), 303));
  }

  // At most FREE_SCANS_PER_IP new checks per address per day; a reused report above costs nothing and is not counted.
  if (env.realEngines) {
    const ipEvent = scanIpEvent(clientIp(req));
    if ((await db.countEventsSince(ipEvent, dayStart())) >= FREE_SCANS_PER_IP) {
      await db.logEvent(null, "scan.refused", { reason: "ip_cap", cap: FREE_SCANS_PER_IP });
      return NextResponse.redirect(to("/scan/druk"), 303);
    }
    await db.logEvent(null, ipEvent, {});
  }

  await db.logEvent(business.id, "scan.requested", { q, created, via: "web" });

  const state = await createScanState(business.id);
  // On Cloudflare a scan outlives a request (several minutes with live
  // engines; waitUntil allows 30 s), so it goes on the queue and the
  // background worker runs it. Elsewhere (local, mock) it runs right after
  // the response. Either way the waiting room polls /api/scan/[token]/status.
  const queue = cloudflareBindings()?.SCAN_QUEUE;
  if (queue) {
    await queue.send({ token: state.token, kind: "free", engines: FREE_SCAN_ENGINES });
  } else {
    after(async () => {
      await startFreeScan(state, { kind: "free", engines: FREE_SCAN_ENGINES });
    });
  }

  return done(NextResponse.redirect(to(`/scan/${state.token}`), 303));
}

export async function GET(req: Request) {
  const copy = copyFor(langFromReferer(req));
  return NextResponse.json({ ok: true, stages: ["understand", "choose", "ask", "compare", "done"], note: copy.scan.waiting });
}
