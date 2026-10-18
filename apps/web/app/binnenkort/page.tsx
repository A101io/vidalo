import type { Metadata } from "next";
import Link from "next/link";
import { getCopy, getI18n } from "@/lib/i18n";
import { Logo } from "@/components/Logo";
import { LangSwitch } from "@/components/LangSwitch";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getCopy();
  return { title: copy.comingSoon.title, description: copy.comingSoon.body, robots: { index: false } };
}

type State = "ok" | "fout" | "druk" | "mislukt";
const STATES: readonly State[] = ["ok", "fout", "druk", "mislukt"];

/**
 * The page behind the launch gate (core/shared/gate.ts). Also reachable
 * directly. Collects the coming-soon list: one field, a consent box, a hidden
 * trap field for bots; /api/waitlist stores it (migration 0007) and comes back
 * here with ?lijst=<state>. The public preview button was removed 18 Oct 2026;
 * the full site opens only with VIDALO_PREVIEW_KEY through /api/preview.
 */
export default async function ComingSoonPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { copy, href } = await getI18n();
  const c = copy.comingSoon;
  const l = c.list;
  const raw = (await searchParams).lijst;
  const state = STATES.find((s) => s === raw) ?? null;
  const error = state === "fout" ? l.invalid : state === "druk" ? l.busy : state === "mislukt" ? l.failed : null;
  return (
    <>
      <header className="site-header">
        <div className="wrap flex items-center justify-between py-4 sm:py-5">
          <Logo size={24} />
          <LangSwitch />
        </div>
      </header>
      <main data-coming-soon className="wrap flex min-h-[70vh] max-w-[720px] flex-col justify-center py-16 sm:py-24">
        <p className="text-[14px] font-semibold uppercase tracking-[0.08em] text-muted">{c.kicker}</p>
        <h1 className="h2 mt-3">{c.h1}</h1>
        <p className="lead mt-5">{c.body}</p>
        <p className="mt-4 text-[16px] text-ink-2">
          {c.contact}{" "}
          <a href="mailto:hello@vidalo.io" className="font-semibold underline underline-offset-2">
            hello@vidalo.io
          </a>
        </p>
        <section id="lijst" aria-labelledby="lijst-h" className="mt-12 max-w-[520px]">
          <h2 id="lijst-h" className="text-[18px] font-bold">
            {l.h2}
          </h2>
          {state === "ok" ? (
            <p role="status" className="mt-3 text-[16px] text-ink-2">
              {l.thanks}
            </p>
          ) : (
            <form action="/api/waitlist" method="post" className="mt-4">
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
                  className="h-[52px] min-w-0 flex-1 border-0 bg-white px-4 text-[15px] placeholder:text-muted focus:outline-none"
                />
                <button type="submit" className="h-[52px] shrink-0 bg-ink px-5 text-[14px] font-extrabold text-white hover:bg-[#1f2937]">
                  {l.button}
                </button>
              </div>
              <label className="mt-3 flex items-start gap-2.5 text-[14px] text-ink-2">
                <input type="checkbox" name="consent" value="ja" required className="mt-[3px] h-4 w-4 shrink-0 accent-[#111827]" />
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
      </main>
      <footer className="border-t-[1.5px] border-line">
        <div className="wrap flex flex-wrap justify-between gap-x-6 gap-y-2 py-8 text-[13px] text-muted">
          <span>{copy.landing.footer.legal}</span>
          <span className="flex flex-wrap gap-x-4">
            <Link href={href("/voorwaarden")} className="nav-link">
              {copy.legal.terms.title}
            </Link>
            <Link href={href("/privacy")} className="nav-link">
              {copy.legal.privacy.title}
            </Link>
            <Link href={href("/cookies")} className="nav-link">
              {copy.legal.cookies.title}
            </Link>
          </span>
        </div>
      </footer>
    </>
  );
}
