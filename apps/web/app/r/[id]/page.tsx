import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ScanReport } from "@vidalo/core/types";
import { getCopy, getI18n } from "@/lib/i18n";
import { getSession, getOwnedBusiness } from "@/lib/session";
import { followPreferredLang } from "@/lib/preferred-lang";
import type { CopyShape } from "@vidalo/core/copy";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { StipHero, Stip } from "@/components/Stip";
import { AnswerCard } from "@/components/AnswerCard";
import { ReportHeaderRow, ReportRow } from "@/components/ReportRow";
import { SourceRow } from "@/components/SourceRow";
import { getScanReport, latestScanReport } from "@/lib/core";
import { ready } from "@/lib/db";
import { dateTimeLong } from "@/lib/format";
import { buildReportView, type BuildViewOptions } from "@/lib/report";
import { DEMO_IDS, DEMO_DOMAIN, DEMO_GREY_DOMAIN, demoGreySources, demoGreyReport, demoReport } from "@/lib/demo";
import { EmailCapture } from "./EmailCapture";

export const dynamic = "force-dynamic";

/** copy.landing.footer.reportNote and the privacy text promise this number. */
const FREE_REPORT_DAYS = 30;

async function load(id: string, copy: CopyShape): Promise<{ report: ScanReport; opts: BuildViewOptions; demo: boolean } | null> {
  if (id === DEMO_IDS.red) return { report: demoReport(), opts: { domain: DEMO_DOMAIN }, demo: true };
  if (id === DEMO_IDS.grey) return { report: demoGreyReport(), opts: { domain: DEMO_GREY_DOMAIN, sources: demoGreySources(copy) }, demo: true };
  const report = (await getScanReport(id)) ?? (await latestScanReport(id));
  if (!report) return null;
  // A free report is reachable for 30 days, as the footer and the privacy
  // text say (docs/content-check.md). Paid customers' reports stay with the
  // account. Expired: the same "niet gevonden" page as an unknown link.
  if (report.kind === "free" && Date.now() - new Date(report.checkedAt).getTime() > FREE_REPORT_DAYS * 86_400_000) return null;
  const db = await ready();
  const business = await db.getBusiness(report.business.id);
  const facts = await db.latestFacts(report.business.id);
  return { report, opts: { domain: business?.domain ?? null, website: facts?.website ?? null, googlePlaceId: business?.googlePlaceId ?? null, kvk: business?.kvk ?? null }, demo: false };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const copy = await getCopy();
  const loaded = await load(id, copy);
  if (!loaded) return { title: copy.result.notFound };
  return { title: copy.email.subjects.report(loaded.report.business.name), robots: { index: false } };
}

export default async function ResultPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mail?: string; betaling?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { copy, href } = await getI18n();
  const loaded = await load(id, copy);
  if (!loaded) notFound();
  const { report, opts, demo } = loaded;
  // The owner reads their own report in the language saved on the account; visitors get the URL's language.
  const viewer = demo ? null : await getSession();
  const owned = viewer ? await getOwnedBusiness(viewer) : null;
  if (owned && owned.id === report.business.id) await followPreferredLang(owned);
  const v = buildReportView(report, copy, opts);
  const R = copy.result;
  const grey = v.state === "grijs";
  const business = demo ? null : await (await ready()).getBusiness(report.business.id);
  const ownerEmail = business?.ownerEmail ?? null;

  return (
    <>
      <SiteHeader variant="minimal" right={R.checkedAt(dateTimeLong(report.checkedAt))} />
      <main className="wrap flex flex-col gap-14 pb-20 pt-4 sm:gap-16 sm:pt-6">
        {/* Hero: the dot */}
        <section className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
          <div className="flex justify-center lg:col-span-4">
            <StipHero tone={report.stip} number={v.hero.number} label={v.hero.label} />
          </div>
          <div className="flex flex-col gap-4 lg:col-span-8">
            <h1 className="h1-sm enter" style={{ "--d": "120ms" } as React.CSSProperties}>
              {v.h1}
            </h1>
            <p className="lead enter max-w-[56ch]" style={{ "--d": "220ms" } as React.CSSProperties}>
              {v.intro}
            </p>
            <div className="enter flex flex-wrap gap-x-6 gap-y-1 text-[14px] text-muted" style={{ "--d": "320ms" } as React.CSSProperties}>
              {v.engineLines.map((e) => (
                <span key={e.name}>
                  <span className="font-bold text-ink">{e.name}</span> {e.text}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Three answers */}
        {v.cards.length > 0 && (
          <section className="enter-kids grid grid-cols-1 gap-4 md:grid-cols-3">
            {v.cards.map((c, i) => (
              <AnswerCard key={i} {...c} />
            ))}
          </section>
        )}

        {/* Per question */}
        <section data-motion="stagger" className="flex flex-col">
          <ReportHeaderRow />
          {v.rows.map((row) => (
            <ReportRow key={row.question + row.tone} row={row} />
          ))}
          {v.instable.length > 0 && (
            <div className="mt-6 flex flex-col gap-2">
              <span className="text-[13px] font-semibold text-muted">{R.table.instableTitle}</span>
              {v.instable.map((f, i) => (
                <div key={i} className="row-grey flex-wrap">
                  <span>
                    <span className="font-semibold">{f.question}</span>{" "}
                    <span className="text-muted">
                      {f.engine}: {f.value}
                    </span>
                  </span>
                  <span className="text-[13px] text-muted">{f.note}</span>
                </div>
              ))}
            </div>
          )}
          <details id="alle" className="mt-4 self-start">
            <summary className="btn-link">{R.table.showAll(report.totalAnswers)}</summary>
            <ul className="mt-3 flex flex-col divide-y-[1px] divide-line rounded-2xl border-[1.5px] border-line text-[14px]">
              {v.all.map((a, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                  <Stip tone={a.tone} />
                  <span className="min-w-0 flex-1 text-ink-2">{a.question}</span>
                  <span className="font-semibold">{a.engine}</span>
                  <span className={a.tone === "rood" ? "text-rood" : a.tone === "grijs" ? "text-muted" : "text-groen"}>{a.value}</span>
                </li>
              ))}
            </ul>
          </details>
        </section>

        {/* Who AI names instead */}
        {v.named.length > 0 && (
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-12">
            <div className="flex flex-col gap-3.5 lg:col-span-5">
              <h2 className="h2-sm">{R.named.h2}</h2>
              <p className="max-w-[48ch] text-[16px] leading-[1.55] text-ink-2">{R.named.body}</p>
              <p className="max-w-[48ch] text-[13px] text-muted">{R.named.note}</p>
            </div>
            <div className="flex flex-col gap-3 lg:col-span-7">
              {v.named.map((n) => (
                <div key={n.question} className="flex flex-col gap-2 rounded-2xl border-[1.5px] border-line p-4 text-[14px]">
                  <span className="font-semibold">{n.question}</span>
                  <span className="text-muted">{n.you}</span>
                  <div className="flex flex-wrap gap-x-2 gap-y-1">
                    <span className="text-muted">{R.named.others}:</span>
                    {n.others.map((o) => (
                      <span key={o.name}>
                        <span className="font-semibold">{o.name}</span> <span className="text-muted">{o.times}</span>
                      </span>
                    ))}
                  </div>
                  {n.sources.length > 0 && (
                    <div className="flex flex-wrap gap-x-2 gap-y-1">
                      <span className="text-muted">{R.named.sources}:</span>
                      {n.sources.map((s) => (
                        <a key={s.host} href={s.href} rel="nofollow noopener" target="_blank" className="btn-link">
                          {s.host}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Where it comes from */}
        {v.sources.length > 0 && (
          <section className="grid grid-cols-1 items-center gap-6 lg:grid-cols-12 lg:gap-12">
            <div className="flex flex-col gap-3.5 lg:col-span-6">
              <h2 className="h2-sm">{v.sourcesTitle}</h2>
              <p className="max-w-[48ch] text-[16px] leading-[1.55] text-ink-2">{v.sourcesBody}</p>
            </div>
            <div data-motion="timeline" className="flex flex-col gap-2 lg:col-span-6">
              {v.sources.map((s) => (
                <SourceRow key={s.label} {...s} />
              ))}
            </div>
          </section>
        )}

        {/* Plan + CTA */}
        <section data-motion="rise" className="panel grid grid-cols-1 items-center gap-8 p-6 sm:p-10 lg:grid-cols-12 lg:gap-10">
          <div className="flex flex-col gap-3.5 lg:col-span-7">
            <h2 className="h2-sm">{v.plan.h2}</h2>
            <ol data-motion="timeline" className="flex flex-col gap-2 text-[16px] leading-[1.5] text-ink-2">
              {v.plan.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span data-stip className="flex">
                    <Stip tone={s.tone} size={22} className="mt-[3px]" />
                  </span>
                  <span>{s.text}</span>
                </li>
              ))}
            </ol>
            {v.plan.note && <p className="text-[13px] text-muted">{v.plan.note}</p>}
          </div>
          <div data-motion="stagger" className="flex flex-col gap-3 lg:col-span-5">
            {(sp.betaling === "geannuleerd" || sp.betaling === "fout") && (
              <p className="rounded-xl border-[1.5px] border-line bg-white px-4 py-3 text-[14px] text-ink-2" aria-live="polite">
                {sp.betaling === "fout" ? copy.checkout.error : copy.checkout.cancelled}
              </p>
            )}
            <form action="/api/checkout" method="post">
              <input type="hidden" name="business" value={report.business.id} />
              <input type="hidden" name="scan" value={report.scanRunId} />
              <input type="hidden" name="plan" value="monitor" />
              <button type="submit" className="btn-primary h-auto w-full whitespace-normal py-4">
                {v.plan.monitor}
              </button>
            </form>
            <form action="/api/checkout" method="post">
              <input type="hidden" name="business" value={report.business.id} />
              <input type="hidden" name="scan" value={report.scanRunId} />
              <input type="hidden" name="plan" value="setup" />
              <button type="submit" className="btn-outline h-auto w-full whitespace-normal py-4">
                {v.plan.setup}
              </button>
            </form>
            <p className="text-center text-[13px] text-muted">{v.plan.excl}</p>
            {!demo && !business?.ownerVerifiedAt && (
              <a href={href(`/eigenaar/bevestigen?business=${encodeURIComponent(report.business.id)}`)} className="text-center text-[14px] font-semibold text-blue">
                {copy.owner.claimLink}
              </a>
            )}
          </div>
        </section>

        {/* Email + self */}
        <section data-motion="stagger" className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <EmailCapture scanRunId={report.scanRunId} businessId={report.business.id} sent={sp.mail === "ok" || Boolean(ownerEmail)} invalid={sp.mail === "fout"} />
          <div className="flex flex-col gap-2.5">
            <h3 className="text-[16px] font-bold">{v.self.h3}</h3>
            <details id="zelf">
              <summary className="text-[15px] leading-[1.5] text-ink-2">
                {v.self.body} <span className="font-bold text-blue">{R.self.link}</span>
              </summary>
              {v.self.steps.length > 0 && (
                <ol className="mt-3 flex flex-col gap-2 text-[14px] leading-[1.5] text-ink-2">
                  {v.self.steps.map((s, i) => (
                    <li key={i} className="rounded-xl bg-panel px-4 py-3">
                      {s}
                    </li>
                  ))}
                </ol>
              )}
            </details>
          </div>
        </section>
      </main>
      {grey ? <SiteFooter variant="short" note={copy.landing.footer.reportNote} /> : <SiteFooter tagline={copy.landing.footer.resultTagline} note={copy.landing.footer.reportNote} />}
    </>
  );
}
