import type { Metadata } from "next";
import Link from "next/link";
import { getCopy, getI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getCopy();
  return { title: copy.scanBusy.title, robots: { index: false } };
}

/** Where /api/scan sends people once the daily free-scan cap is reached, or when the bot check failed. */
export default async function ScanBusyPage({ searchParams }: { searchParams: Promise<{ check?: string; mail?: string }> }) {
  const { copy, href } = await getI18n();
  const b = copy.scanBusy;
  const sp = await searchParams;
  // ?check=1: the bot check failed (lib/turnstile.ts), not the daily cap.
  const check = sp.check === "1";
  // ?mail=1: enough confirmation mails for this address or connection today (lib/scan-confirm.ts).
  const mail = !check && sp.mail === "1";
  return (
    <>
      <SiteHeader variant="minimal" />
      <main className="wrap max-w-[640px] py-16 sm:py-24">
        <h1 className="h2">{check ? copy.errors.humanCheck : mail ? b.mailTitle : b.title}</h1>
        {!check && <p className="lead mt-4">{mail ? b.mailBody : b.body}</p>}
        <Link href={href("/")} className="btn-sm mt-8 inline-flex">
          {b.back}
        </Link>
      </main>
      <SiteFooter variant="short" />
    </>
  );
}
