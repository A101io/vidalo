import type { Metadata } from "next";
import Link from "next/link";
import { getCopy, getI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ready } from "@/lib/db";
import { findPending, parseConfirmToken } from "@vidalo/core/shared";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getCopy();
  return { title: copy.scan.confirm.button, robots: { index: false }, referrer: "no-referrer" };
}

/**
 * The link in the confirmation mail lands here. Opening it starts nothing (mail
 * scanners open links); the button posts to /api/scan/bevestigen, which does.
 */
export default async function ScanConfirmPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const t = (await searchParams).t ?? "";
  const { copy, href } = await getI18n();
  const C = copy.scan.confirm;
  const parsed = parseConfirmToken(t);
  const db = await ready();
  const business = parsed ? await db.getBusiness(parsed.businessId) : null;
  const found = parsed && business ? findPending(await db.listEvents(business.id, 500), parsed.hash) : null;
  // A used link sends the button to where the first press went; the route handles that.
  const usable = !!business && (found?.ok || (found?.reason === "used" && !!found.to));
  return (
    <>
      <SiteHeader variant="minimal" />
      <main className="wrap max-w-[640px] py-16 sm:py-24">
        {usable && business ? (
          <>
            <h1 className="h2">{C.title(business.name)}</h1>
            <p className="lead mt-4">{C.body}</p>
            <form method="post" action="/api/scan/bevestigen" className="mt-8">
              <input type="hidden" name="t" value={t} />
              <button type="submit" className="btn-primary inline-flex h-[52px]">
                {C.button}
              </button>
            </form>
            <p className="mt-6 text-[15px] text-ink-2">{C.why}</p>
          </>
        ) : (
          <>
            <h1 className="h2">{C.sentTitle}</h1>
            <p className="lead mt-4">{C.invalid}</p>
            <Link href={href("/#controle")} className="btn-sm mt-8 inline-flex">
              {C.back}
            </Link>
          </>
        )}
      </main>
      <SiteFooter variant="short" />
    </>
  );
}
