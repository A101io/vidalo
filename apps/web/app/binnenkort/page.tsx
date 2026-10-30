import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT, telHref, waHref } from "@vidalo/core/shared";
import { getCopy, getI18n } from "@/lib/i18n";
import { Wordmark } from "@/components/SiteHeader";
import { LangSwitch } from "@/components/LangSwitch";
import { LogoIntro } from "@/components/LogoIntro";
import { ComingSoonFooter } from "@/components/ComingSoonFooter";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getCopy();
  return { title: copy.comingSoon.title, description: copy.comingSoon.body, robots: { index: false } };
}

type State = "ok" | "fout" | "toestemming" | "druk" | "mislukt";
const STATES: readonly State[] = ["ok", "fout", "toestemming", "druk", "mislukt"];

/**
 * The page behind the launch gate (core/shared/gate.ts). Also reachable
 * directly. Collects the coming-soon list: one field, a consent box, a hidden
 * trap field for bots; /api/waitlist stores it (migration 0009) and comes back
 * here with ?lijst=<state>. The public preview button was removed 18 Oct 2026;
 * the full site opens only with VIDALO_PREVIEW_KEY through /api/preview.
 */
export default async function ComingSoonPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { copy, href } = await getI18n();
  const c = copy.comingSoon;
  const l = c.list;
  const raw = (await searchParams).lijst;
  const state = STATES.find((s) => s === raw) ?? null;
  const error = state === "fout" ? l.invalid : state === "toestemming" ? l.noConsent : state === "druk" ? l.busy : state === "mislukt" ? l.failed : null;
  return (
    <>
      {/* One screen: header, then text + list on the left and the animation on the right (stacked on a phone). The footer sits just below. */}
      <div className="flex min-h-svh flex-col">
        <header className="wrap flex shrink-0 items-center justify-between py-4 sm:py-5">
          <Wordmark />
          <LangSwitch />
        </header>
        <main data-coming-soon className="wrap flex flex-1 items-center pb-4 pt-1 sm:pb-6 lg:pb-12">
          <div className="grid w-full items-center gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
            <div className="cs-visual order-first flex h-[clamp(96px,18svh,150px)] items-center justify-center overflow-hidden rounded-card border-[1.5px] border-line bg-[#F8FAFC] lg:order-last lg:h-[min(440px,58svh)]">
              <LogoIntro questions={c.intro.questions as unknown as readonly [string, string, string]} name={copy.nav.wordmark} label={c.intro.label} />
            </div>
            <div className="max-w-[560px]">
              <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted sm:text-[14px]">{c.kicker}</p>
              <h1 className="h2 mt-2 sm:mt-3">{c.h1}</h1>
              <p className="mt-3 text-[16px] leading-[1.5] text-ink-2 sm:mt-4 sm:text-[18px] sm:leading-[1.55]">{c.body}</p>
              <section id="lijst" aria-labelledby="lijst-h" className="mt-6 sm:mt-8">
                <h2 id="lijst-h" className="text-[16px] font-bold sm:text-[17px]">
                  {l.h2}
                </h2>
                {state === "ok" ? (
                  <p role="status" className="mt-3 rounded-btn border-[1.5px] border-line px-4 py-3.5 text-[15px] text-ink-2">
                    {l.thanks}
                  </p>
                ) : (
                  <form action="/api/waitlist" method="post" noValidate className="mt-3">
                    {/* noValidate: the browser's own "fill in this field" bubble speaks the browser's language, not the page's; /api/waitlist answers in the page's language instead. */}
                    <input type="hidden" name="lang" value={c.lang} />
                    {/* A field people never see; a bot that fills it is thanked and nothing is stored. */}
                    <div aria-hidden="true" className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden">
                      <label htmlFor="website">Website</label>
                      <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
                    </div>
                    <label htmlFor="lijst-email" className="sr-only">
                      {l.label}
                    </label>
                    <div className="flex overflow-hidden rounded-btn border-[1.5px] border-ink bg-white">
                      <input
                        id="lijst-email"
                        name="email"
                        type="email"
                        required
                        maxLength={254}
                        autoComplete="email"
                        placeholder={l.placeholder}
                        aria-invalid={state === "fout" || undefined}
                        aria-describedby={error ? "lijst-error" : undefined}
                        className="h-[50px] min-w-0 flex-1 border-0 bg-white px-4 text-[16px] placeholder:text-muted focus:outline-none"
                      />
                      <button type="submit" className="h-[50px] shrink-0 bg-ink px-4 text-[14px] font-extrabold text-white hover:bg-[#1f2937] sm:px-5">
                        {l.button}
                      </button>
                    </div>
                    <label className="mt-2.5 flex items-start gap-2.5 text-[13px] leading-[1.45] text-ink-2 sm:text-[14px]">
                      <input type="checkbox" name="consent" value="ja" required aria-invalid={state === "toestemming" || undefined} aria-describedby={state === "toestemming" ? "lijst-error" : undefined} className="mt-[2px] h-4 w-4 shrink-0 accent-[#111827]" />
                      <span>
                        {l.consent}{" "}
                        <Link href={href("/privacy")} className="underline underline-offset-2">
                          {copy.legal.privacy.title}
                        </Link>
                      </span>
                    </label>
                    {error && (
                      <p id="lijst-error" role="alert" className="mt-2 text-[14px] text-rood">
                        {error}
                      </p>
                    )}
                  </form>
                )}
              </section>
              <div className="mt-5 text-[14px] text-muted sm:mt-6">
                <p>{c.contact.lead}</p>
                <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                  <a href={waHref(CONTACT.whatsapp)} target="_blank" rel="noopener" className="font-semibold text-ink underline underline-offset-2">
                    {c.contact.whatsapp} {CONTACT.whatsapp}
                  </a>
                  <a href={telHref(CONTACT.phone)} className="font-semibold text-ink underline underline-offset-2">
                    {c.contact.phone} {CONTACT.phone}
                  </a>
                  <a href={`mailto:${CONTACT.email}`} className="font-semibold text-ink underline underline-offset-2">
                    {CONTACT.email}
                  </a>
                </p>
                <p className="mt-1.5">
                  <Link href={href("/contact")} className="nav-link">
                    {c.contact.more}
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
      <ComingSoonFooter />
    </>
  );
}
