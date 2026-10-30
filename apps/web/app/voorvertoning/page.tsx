import type { Metadata } from "next";
import { getCopy, getI18n } from "@/lib/i18n";
import { Wordmark } from "@/components/SiteHeader";
import { LangSwitch } from "@/components/LangSwitch";
import { ComingSoonFooter } from "@/components/ComingSoonFooter";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getCopy();
  return { title: copy.comingSoon.previewPage.title, robots: { index: false, follow: false } };
}

/**
 * The key form for the full site behind the launch gate (Julian, 23 Oct 2026):
 * the same key and the same check as before (/api/preview, VIDALO_PREVIEW_KEY,
 * constant-time compare), without the browser console. Never linked, noindex,
 * not in the sitemap; the gate lets it through like the legal pages.
 */
export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ fout?: string }> }) {
  const { copy } = await getI18n();
  const c = copy.comingSoon;
  const p = c.previewPage;
  const wrong = (await searchParams).fout === "1";
  return (
    <>
      <div className="flex min-h-svh flex-col">
        <header className="wrap flex shrink-0 items-center justify-between py-4 sm:py-5">
          <Wordmark />
          <LangSwitch />
        </header>
        <main className="wrap flex flex-1 items-center pb-12 pt-1">
          <div className="w-full max-w-[460px]">
            <h1 className="h2">{p.h1}</h1>
            <p className="mt-3 text-[16px] leading-[1.5] text-ink-2">{p.body}</p>
            <form action="/api/preview" method="post" className="mt-6">
              <input type="hidden" name="lang" value={c.lang} />
              <input type="hidden" name="from" value="voorvertoning" />
              <label htmlFor="preview-key" className="text-[14px] font-semibold">
                {p.label}
              </label>
              <input
                id="preview-key"
                name="key"
                type="password"
                required
                autoComplete="off"
                spellCheck={false}
                aria-invalid={wrong || undefined}
                aria-describedby={wrong ? "preview-error" : undefined}
                className="mt-2 h-[50px] w-full rounded-btn border-[1.5px] border-ink bg-white px-4 text-[16px] focus:outline-none"
              />
              {wrong && (
                <p id="preview-error" role="alert" className="mt-2 text-[14px] text-rood">
                  {p.wrong}
                </p>
              )}
              <button type="submit" className="btn-primary mt-4 h-[50px] w-full">
                {p.button}
              </button>
            </form>
          </div>
        </main>
      </div>
      <ComingSoonFooter />
    </>
  );
}
