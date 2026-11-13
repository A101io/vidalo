import type { Metadata } from "next";
import Link from "next/link";
import { getCopy, getI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getCopy();
  return { title: copy.scan.confirm.sentTitle, robots: { index: false } };
}

/** After POST /api/scan: the link that starts the check is on its way (core/shared/scan-confirm.ts). */
export default async function ScanMailPage({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  const { copy, href } = await getI18n();
  const C = copy.scan.confirm;
  // Mock engines only (lib/scan-confirm.ts): the link the mail carries, for tests and local runs.
  const link = !env.realEngines ? (await searchParams).link : undefined;
  return (
    <>
      <SiteHeader variant="minimal" />
      <main className="wrap max-w-[640px] py-16 sm:py-24">
        <h1 className="h2">{C.sentTitle}</h1>
        <p className="lead mt-4">{C.sentBody}</p>
        <p className="mt-6 text-[15px] text-ink-2">{C.why}</p>
        <p className="mt-3 text-[15px] text-ink-2">{C.spam}</p>
        {link && (
          <p className="mt-6 text-[15px]">
            <a data-testid="confirm-link" href={href(`/scan/bevestigen?t=${encodeURIComponent(link)}`)} className="underline">
              Mock: {href(`/scan/bevestigen`)}
            </a>
          </p>
        )}
        <Link href={href("/")} className="btn-sm mt-8 inline-flex">
          {C.back}
        </Link>
      </main>
      <SiteFooter variant="short" />
    </>
  );
}
