import Link from "next/link";
import { redirect } from "next/navigation";
import { PAUSE_MONTHS, pauseEnd, subscriptionOptions } from "@vidalo/core/billing";
import { longDate } from "@vidalo/core/reporter";
import { getI18n } from "@/lib/i18n";
import { requireOwner } from "@/lib/owner";
import { pauseAction } from "../actions";

export const dynamic = "force-dynamic";

/** Pause for 1, 2 or 3 months (core/billing/lifecycle.ts). */
export default async function PausePage({ searchParams }: { searchParams: Promise<{ fout?: string }> }) {
  const sp = await searchParams;
  const { business } = await requireOwner("/app/abonnement/pauzeren");
  const { copy, href, lang } = await getI18n();
  if (!subscriptionOptions(business).canPause) redirect(href("/app/abonnement"));
  const P = copy.billing.manage.pause;
  const now = new Date();
  return (
    <div className="max-w-[640px] space-y-6">
      <h1 className="h2">{P.h1}</h1>
      <div className="space-y-3 text-[16px] text-ink-2">
        <p>{P.intro}</p>
        <p>{P.stops}</p>
        <p>{P.stays}</p>
        <p>{P.restart}</p>
      </div>
      <form action={pauseAction} className="card space-y-4 p-5 sm:p-6">
        <fieldset className="space-y-3">
          <legend className="field-label">{P.label}</legend>
          {PAUSE_MONTHS.map((m, i) => (
            <label key={m} className="flex items-center gap-3 text-[16px]">
              <input type="radio" name="months" value={m} defaultChecked={i === 0} required />
              {P.option(m, longDate(pauseEnd(now, m).toISOString(), lang))}
            </label>
          ))}
        </fieldset>
        {sp.fout === "1" && <p className="text-[14px] text-rood">{copy.billing.manage.error}</p>}
        <button type="submit" className="btn-primary h-[52px] px-6">
          {P.button}
        </button>
      </form>
      <Link href={href("/app/abonnement")} className="btn-link">
        {P.back}
      </Link>
    </div>
  );
}
