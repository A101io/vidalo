import type { Metadata } from "next";
import Link from "next/link";
import { getCopy, getI18n } from "@/lib/i18n";
import { env } from "@/lib/env";
import { Logo } from "@/components/Logo";
import { LangSwitch } from "@/components/LangSwitch";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getCopy();
  return { title: copy.comingSoon.title, description: copy.comingSoon.body, robots: { index: false } };
}

/**
 * The page behind the launch gate (core/shared/gate.ts). Also reachable
 * directly. The button at the bottom is temporary: it sets the preview
 * cookie so a reviewer can walk the whole site; VIDALO_PREVIEW_BUTTON=0
 * removes it (go-live J4) while /api/preview keeps working with the key.
 */
export default async function ComingSoonPage() {
  const { copy, href } = await getI18n();
  const c = copy.comingSoon;
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
        {env.previewButton && (
          <form action="/api/preview" method="post" className="mt-10">
            <input type="hidden" name="lang" value={c.lang} />
            <button type="submit" className="btn-outline h-[48px] px-6">
              {c.previewButton}
            </button>
            <p className="mt-2 text-[13px] text-muted">{c.previewNote}</p>
          </form>
        )}
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
