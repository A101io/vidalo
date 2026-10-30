import Link from "next/link";
import { getI18n } from "@/lib/i18n";
import { Wordmark } from "@/components/SiteHeader";
import { requireOwner } from "@/lib/owner";
import { followPreferredLang } from "@/lib/preferred-lang";
import { loadLastConfirmedFacts } from "@/lib/reads";
import { dateShort } from "@/lib/format";
import { reconfirmation } from "@vidalo/core/facts-history";
import { reconfirmFacts } from "./gegevens/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { business, session } = await requireOwner();
  await followPreferredLang(business);
  const { copy, href } = await getI18n();
  const d = copy.dashboard;
  // "Klopt dit nog?": a year after the last confirmation, on every /app page until the owner answers.
  const yearly = reconfirmation(await loadLastConfirmedFacts(business.id));
  const R = copy.reconfirm;
  const links = [
    { href: "/app", label: d.h1 },
    { href: "/app/voortgang", label: copy.progress.nav },
    { href: "/app/gegevens", label: d.setupSteps.facts },
    { href: "/app/domein", label: d.setupSteps.domain },
    { href: "/app/google", label: d.setupSteps.google },
    { href: "/app/abonnement", label: d.billingNav },
    { href: "/app/account", label: copy.account.nav },
  ];
  return (
    <>
      <header className="site-header site-header--ruled">
        <div className="wrap flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4 sm:py-5">
          <div className="flex items-center gap-4">
            <Wordmark href="/app" />
            <span className="hidden text-[14px] text-muted sm:inline">
              {business.name}, {business.place}
            </span>
          </div>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px] font-semibold">
            {links.map((l) => (
              <Link key={l.href} href={href(l.href)}>
                {l.label}
              </Link>
            ))}
            <form action="/auth/uitloggen" method="post">
              <button type="submit" className="font-semibold text-muted hover:text-blue" title={session.email}>
                {copy.nav.logout}
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="wrap max-w-[1000px] py-8 sm:py-12">
        {yearly?.due && (
          <section aria-labelledby="klopt-dit-nog" className="card mb-8 flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="klopt-dit-nog" className="text-[17px] font-bold">
                {R.h}
              </h2>
              <p className="mt-1 text-[15px] text-ink-2">{R.body(dateShort(yearly.confirmedAt), yearly.cycle)}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-4">
              <form action={reconfirmFacts}>
                <button type="submit" className="btn-sm">
                  {R.confirm}
                </button>
              </form>
              <Link href={href("/app/gegevens")} className="btn-link">
                {R.edit}
              </Link>
            </div>
          </section>
        )}
        {children}
      </main>
    </>
  );
}
