import Link from "next/link";
import { getI18n } from "@/lib/i18n";
import { requireOwner } from "@/lib/owner";
import { requireFreshSignIn } from "@/lib/fresh-sign-in";
import { longDate } from "@vidalo/core/reporter";
import { deletionPlan } from "@vidalo/core/shared";
import { deleteMyData } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The delete step (feature 002, AC-5b/c, F-014): what goes, what stays, what happens to the money
 * and the invoices, all before the one button. Needs a sign-in from the last 15 minutes, here and
 * again on the POST (SEC-37).
 */
export default async function DeletePage() {
  const { business } = await requireOwner("/app/account/verwijderen");
  await requireFreshSignIn("/app/account/verwijderen");
  const { copy, href, lang } = await getI18n();
  const D = copy.accountSecurity.deletion;
  const plan = deletionPlan(business);
  const money = plan.kind === "at_period_end" ? (plan.at ? D.monthlyAt(longDate(plan.at, lang)) : D.monthlyNext) : business.plan === "setup" ? D.scan : null;
  return (
    <div className="max-w-[640px] space-y-6">
      <header>
        <h1 className="h2">{D.h}</h1>
        <p className="mt-2 text-[17px] text-ink-2">{D.intro(business.name)}</p>
      </header>
      <section className="card space-y-4 p-5 text-[15px] sm:p-6">
        <div>
          <h2 className="font-semibold">{D.goesH}</h2>
          <p className="mt-1 text-ink-2">{D.goes}</p>
        </div>
        <div>
          <h2 className="font-semibold">{D.staysH}</h2>
          <p className="mt-1 text-ink-2">{D.stays}</p>
        </div>
        {money && (
          <div data-money>
            <h2 className="font-semibold">{D.moneyH}</h2>
            <p className="mt-1 text-ink-2">{money}</p>
          </div>
        )}
        <div data-invoices>
          <p className="text-ink-2">{D.invoices}</p>
          <form action="/api/billing/portal" method="post" className="mt-2">
            <input type="hidden" name="business" value={business.id} />
            <button type="submit" className="btn-link">
              {D.invoicesButton}
            </button>
          </form>
        </div>
      </section>
      <form action={deleteMyData} className="card space-y-4 p-5 sm:p-6">
        <input type="hidden" name="business" value={business.id} />
        <label className="flex items-start gap-2 text-[15px]">
          <input type="checkbox" name="confirm" value="ja" required className="mt-1" />
          <span>{D.confirm(business.name)}</span>
        </label>
        <button type="submit" className="btn-primary">
          {D.button}
        </button>
      </form>
      <Link href={href("/app/account#gegevens")} className="btn-link">
        {D.back}
      </Link>
    </div>
  );
}
