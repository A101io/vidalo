import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCopy, getI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ScanField } from "@/components/ScanField";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getCopy()).checks.newTitle, robots: { index: false } };
}

/**
 * A new free check from behind the login (13 Nov 2026). Before, the only way in was the link on /inloggen to the
 * anonymous landing page: an owner with a business was sent to /app, which had no entry at all, and everyone else
 * landed on the marketing page with an empty form. This is the same form (ScanField → /api/scan → /scan/kies), with
 * the signed-in address filled in. The robot check and the rate limits are those of the form, unchanged.
 */
export default async function NewCheckPage() {
  const { copy, href } = await getI18n();
  const session = await getSession();
  if (!session) redirect(href("/inloggen?next=%2Fcontrole"));
  const C = copy.checks;
  return (
    <>
      <SiteHeader variant="minimal" right={session.email} />
      <main className="wrap max-w-[560px] py-12 sm:py-16">
        <h1 className="h2">{C.newH1}</h1>
        <p className="lead mt-3">{C.newBody(session.email)}</p>
        <ScanField id="nieuw" className="mt-8" defaultEmail={session.email} button={C.newButton} note={false} />
      </main>
      <SiteFooter variant="short" />
    </>
  );
}
