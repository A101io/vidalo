import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCopy, getI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { getSession } from "@/lib/session";
import { ready } from "@/lib/db";
import { removeCheck } from "@vidalo/core/db";
import { dateShort } from "@/lib/format";
import { removeMyCheck } from "../../actions";
import { removeBackTarget } from "@/lib/remove-back";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getCopy()).checks.removeTitle, robots: { index: false } };
}

/** The confirm step before a check is removed. It asks core what would happen (a dry run); the button posts to the action, which asks again. */
export default async function RemoveCheckPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ terug?: string }> }) {
  const { id } = await params;
  const back = removeBackTarget((await searchParams).terug);
  const { copy, href } = await getI18n();
  const C = copy.checks;
  const session = await getSession();
  if (!session) redirect(href(`/inloggen?next=${encodeURIComponent(`/controle/verwijderen/${id}?terug=${back}`)}`));
  const db = await ready();
  const dry = await removeCheck(db, { userId: session.userId, email: session.email }, id, { dryRun: true });
  if (!dry.ok) redirect(href(`${back}?controle=${dry.reason}`));
  const run = (await db.getScanRun(id))!;
  const business = (await db.getBusiness(run.businessId))!;
  return (
    <>
      <SiteHeader variant="minimal" />
      <main className="wrap max-w-[640px] py-16 sm:py-24">
        <h1 className="h2">{C.removeH1(business.name, business.place)}</h1>
        <p className="mt-2 text-[15px] text-muted">{dateShort(run.finishedAt ?? run.startedAt)}</p>
        <p className="lead mt-4">{dry.outcome === "removed" ? C.removeBodyRemoved : C.removeBodyUnlinked}</p>
        <form action={removeMyCheck} className="mt-8 flex flex-wrap items-center gap-4">
          <input type="hidden" name="run" value={id} />
          <input type="hidden" name="back" value={back} />
          <button type="submit" className="btn-primary">
            {C.removeConfirm}
          </button>
          <Link href={href(back)} className="btn-link">
            {C.removeCancel}
          </Link>
        </form>
      </main>
      <SiteFooter variant="short" />
    </>
  );
}
