import { notFound, redirect } from "next/navigation";
import { getI18n } from "@/lib/i18n";
import { localizeHref } from "@/lib/lang-paths";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ready } from "@/lib/db";
import { getScanState } from "@/lib/core";
import { scanStatusBody } from "@vidalo/core/scanner";
import { ScanProgress } from "./ScanProgress";

export const dynamic = "force-dynamic";

export default async function ScanWaitingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { copy, lang, href } = await getI18n();
  const db = await ready();
  const state = await getScanState(id);
  if (!state) notFound();
  if (state.status === "done" && state.scanRunId) redirect(href(`/r/${state.scanRunId}`));
  const business = await db.getBusiness(state.businessId);
  const name = business?.name ?? "";
  return (
    <>
      <SiteHeader variant="minimal" right={business ? `${business.name}, ${business.place}` : undefined} />
      <main className="wrap max-w-[760px] py-12 sm:py-16">
        <h1 className="h2">{copy.scan.title}</h1>
        {/* Without JavaScript the page reloads itself; the same state comes from the server render. */}
        <noscript>
          <meta httpEquiv="refresh" content="5" />
          <p className="mt-3 text-[14px]"><a className="btn-link" href={localizeHref(`/scan/${encodeURIComponent(id)}`, lang)}>{copy.scan.refresh}</a></p>
        </noscript>
        {/* Only the status endpoint's fields reach the browser, never the whole stored state. */}
        <ScanProgress token={state.token} businessName={name} initial={scanStatusBody(state)} lang={lang} />
      </main>
      <SiteFooter />
    </>
  );
}
