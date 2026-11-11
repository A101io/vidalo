import { notFound, redirect } from "next/navigation";
import { getI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ready } from "@/lib/db";
import { getScanState } from "@/lib/core";
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
  return (
    <>
      <SiteHeader variant="minimal" right={business ? `${business.name}, ${business.place}` : undefined} />
      <main className="wrap max-w-[760px] py-12 sm:py-16">
        <h1 className="h2">{copy.scan.title}</h1>
        <ScanProgress scanRunId={state.token} initialSteps={state.steps ?? []} initialStatus={state.status} lang={lang} />
      </main>
      <SiteFooter />
    </>
  );
}
