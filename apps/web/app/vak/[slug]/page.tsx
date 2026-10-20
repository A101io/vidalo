import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SECTOR_SLUGS, type SectorSlug } from "@vidalo/core/types";
import { isSectorSlug } from "@vidalo/core/prompts";
import { pageMetadata } from "@/lib/seo";
import { getI18n, localizeHref } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ScanField } from "@/components/ScanField";
import { Stip } from "@/components/Stip";
import { severityTone } from "@/components/CriteriumCard";
import { sectorQuestions } from "@/lib/sector";

export const dynamicParams = false;

export function generateStaticParams(): { slug: SectorSlug }[] {
  return SECTOR_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!isSectorSlug(slug)) return {};
  const { copy, lang } = await getI18n();
  const p = copy.sectorPages[slug];
  return pageMetadata({ title: `${p.short}: ${p.h1}`, description: p.intro, route: `/vak/${slug}`, lang });
}

export default async function SectorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isSectorSlug(slug)) notFound();
  const { copy, href } = await getI18n();
  const S = copy.sector;
  const P = copy.sectorPages[slug];
  const questions = sectorQuestions(slug, copy);

  return (
    <>
      <SiteHeader variant="short" />
      <main>
        {/* Switcher */}
        <nav aria-label={S.switcherLabel} className="wrap flex flex-wrap gap-2 pt-2 text-[14px] font-semibold">
          {SECTOR_SLUGS.map((s) =>
            s === slug ? (
              <span key={s} className="pill-dark">
                {copy.sectorPages[s].short}
              </span>
            ) : (
              <Link key={s} href={href(`/vak/${s}`)} className="pill hover:border-ink">
                {copy.sectorPages[s].short}
              </Link>
            ),
          )}
        </nav>

        {/* Hero */}
        <section className="wrap grid grid-cols-1 items-center gap-10 pb-16 pt-10 lg:grid-cols-12 lg:gap-12 lg:pb-20 lg:pt-14">
          <div className="flex flex-col gap-6 lg:col-span-6">
            <h1 className="h1 text-[36px] sm:text-[44px] lg:text-[52px]" style={{ letterSpacing: "-1.5px" }}>
              {P.h1}
            </h1>
            <p className="lead max-w-[44ch]">{P.intro}</p>
            <ScanField id="hero" className="max-w-[440px]" namePlaceholder={S.namePlaceholder(P.nounYour)} note={false} />
          </div>
          <div className="flex flex-col gap-3 lg:col-span-6">
            <div className="max-w-[85%] self-end rounded-[18px] rounded-br-[4px] bg-dark px-[18px] py-3.5 text-[16px] leading-[1.4] text-white">{P.chat.question}</div>
            <div className="rounded-[18px] rounded-bl-[4px] bg-panel px-5 py-[18px] text-[16px] leading-[1.5]">
              <div className="label mb-1.5">{P.chat.engine}</div>
              {P.chat.intro}
              {P.chat.answers.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {P.chat.answers.map((a) => (
                    <div key={a}>{a}</div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 rounded-[14px] border-[1.5px] border-line px-4 py-3 text-[14px]">
              <Stip tone="rood" size={12} />
              <span>
                <span className="font-bold">{P.miss.strong}</span> {P.miss.body}
              </span>
            </div>
          </div>
        </section>

        {/* Three facts */}
        <section className="ground-sky">
          <div className="wrap section flex flex-col gap-9">
            <h2 className="h2 max-w-[22ch]">{S.factsH2(P.noun)}</h2>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              {P.facts.map((f) => (
                <div key={f.title} className="card flex flex-col gap-3 rounded-[20px] p-6">
                  <span className="text-[20px] font-extrabold">{f.title}</span>
                  <span className="text-[15px] leading-[1.55] text-ink-2">{f.body}</span>
                  <span className="mt-auto rounded-xl bg-panel px-3.5 py-3 text-[14px]">
                    <span className="text-muted">{S.factQuestion}</span> {f.question}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* What we check for this sector */}
        <section className="wrap section grid grid-cols-1 items-start gap-8 lg:grid-cols-12 lg:gap-12">
          <div className="flex flex-col gap-3.5 lg:col-span-5">
            <h2 className="h2">{S.checkH2(P.nounPlural)}</h2>
            <p className="text-[16px] leading-[1.55] text-ink-2">{S.checkIntro(questions.length)}</p>
          </div>
          <div className="flex flex-col lg:col-span-7">
            <div className="hidden border-b-[1.5px] border-ink py-2.5 text-[12px] font-semibold text-muted sm:grid sm:grid-cols-[1fr_150px_150px] sm:gap-3">
              <span>{S.table.question}</span>
              <span>{S.table.criterium}</span>
              <span>{S.table.severity}</span>
            </div>
            {questions.map((q) => (
              <div key={q.text} className="flex flex-col gap-1.5 border-b-[1.5px] border-line py-3 text-[15px] sm:grid sm:grid-cols-[1fr_150px_150px] sm:items-center sm:gap-3">
                <span>{q.text}</span>
                <span className="text-[14px] text-muted">{copy.criteria[q.criterium.id]}</span>
                <span className="flex items-center gap-2 text-[14px]">
                  <Stip tone={severityTone[q.severity]} />
                  {copy.severity[q.severity]}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Why it matters */}
        <section className="bg-dark text-white">
          <div className="wrap section grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-12">
            <div className="flex flex-col gap-4 lg:col-span-6">
              <h2 className="h2">{S.why.h2}</h2>
              <p className="text-[17px] leading-[1.55] text-dark-text">{S.why.body}</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-6">
              {[S.why.stats[0]!, P.whyStat, S.why.stats[1]!].map((s) => (
                <div key={s.body} className="rounded-2xl bg-dark-panel p-[22px]">
                  <div className="text-[34px] font-extrabold leading-none" style={{ letterSpacing: "-1px" }}>
                    {s.n}
                  </div>
                  <div className="mt-1.5 text-[14px] leading-[1.5] text-dark-text">{s.body}</div>
                  <div className="mt-1.5 text-[11px] text-grijs">{s.source}</div>
                </div>
              ))}
              <div className="rounded-2xl bg-blue p-[22px]">
                <div className="text-[34px] font-extrabold leading-none" style={{ letterSpacing: "-1px" }}>
                  {S.why.recheck.n}
                </div>
                <div className="mt-1.5 text-[14px] leading-[1.5]">{S.why.recheck.body}</div>
              </div>
            </div>
          </div>
        </section>

        {/* Before / after */}
        <section className="wrap section flex flex-col gap-7">
          <h2 className="h2">{S.example.h2(P.example.name)}</h2>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="card flex flex-col gap-3.5 rounded-[20px] p-6">
              <div className="flex items-center gap-2.5">
                <Stip tone="rood" size={14} />
                <span className="text-[14px] font-bold text-muted">{S.example.before(P.example.beforeDate)}</span>
              </div>
              {P.example.before.map((b) => (
                <p key={b.q} className="text-[15px] leading-[1.55]">
                  <span className="font-bold">{b.q}</span>
                  <br />
                  {b.a}
                </p>
              ))}
              <p className="border-t-[1.5px] border-line pt-2.5 text-[13px] text-muted">
                {S.example.sources} {P.example.sources}
              </p>
            </div>
            <div className="flex flex-col gap-3.5 rounded-[20px] border-[1.5px] border-groen bg-[#F0FDF4] p-6">
              <div className="flex items-center gap-2.5">
                <Stip tone="groen" size={14} />
                <span className="text-[14px] font-bold text-groen-ink">{S.example.after(P.example.afterDate)}</span>
              </div>
              {P.example.after.map((b) => (
                <p key={b.q} className="text-[15px] leading-[1.55]">
                  <span className="font-bold">{b.q}</span>
                  <br />
                  {b.a}
                </p>
              ))}
              <p className="border-t-[1.5px] border-[#BBF7D0] pt-2.5 text-[13px] text-groen-ink">
                {S.example.fixed} {P.example.fixed}
              </p>
            </div>
          </div>
          <p className="fine">{S.example.footnote}</p>
        </section>

        {/* CTA */}
        <section className="ground-warm">
          <div className="wrap section flex flex-col items-center gap-6 text-center">
            <h2 className="h2 max-w-[22ch]">{S.ctaH2(P.nounYour)}</h2>
            <ScanField id="slot" className="max-w-[440px]" />
          </div>
        </section>
      </main>
      <SiteFooter variant="short" />
    </>
  );
}
