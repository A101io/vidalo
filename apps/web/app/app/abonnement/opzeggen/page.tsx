import Link from "next/link";
import { redirect } from "next/navigation";
import { CANCEL_REASONS, subscriptionOptions } from "@vidalo/core/billing";
import { longDate } from "@vidalo/core/reporter";
import { getI18n } from "@/lib/i18n";
import { requireOwner } from "@/lib/owner";
import { currentPeriodEnd } from "@/lib/subscription";
import { cancelAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Cancel (core/billing/lifecycle.ts, docs/CANCEL-PAUSE.md): one page, one
 * button. It says when it ends, what stops and what stays, offers the pause
 * once as a plain link, and asks a reason that may stay empty.
 */
export default async function CancelPage() {
  const { business } = await requireOwner("/app/abonnement/opzeggen");
  const { copy, href, lang } = await getI18n();
  const options = subscriptionOptions(business);
  if (!options.canCancel) redirect(href("/app/abonnement"));
  const C = copy.billing.manage.cancel;
  const end = longDate((await currentPeriodEnd(business.stripeSubscriptionId)).toISOString(), lang);
  return (
    <div className="max-w-[640px] space-y-6">
      <h1 className="h2">{C.h1}</h1>
      <p className="text-[16px] text-ink-2">{C.intro(end)}</p>
      <section className="card p-5 sm:p-6">
        <h2 className="h3">{C.whatTitle(end)}</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[15px] text-ink-2">
          {C.what.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        <p className="mt-4 text-[15px] text-ink-2">{C.undo}</p>
      </section>
      {options.canPause && (
        <p className="text-[15px]">
          {C.pauseAlt}{" "}
          <Link href={href("/app/abonnement/pauzeren")} className="btn-link">
            {C.pauseAltLink}
          </Link>
        </p>
      )}
      <form action={cancelAction} className="card space-y-4 p-5 sm:p-6">
        <label className="block">
          <span className="field-label">{C.reasonLabel}</span>
          <select name="reason" defaultValue="" className="field">
            <option value="">{C.noReason}</option>
            {CANCEL_REASONS.map((r) => (
              <option key={r} value={r}>
                {C.reasons[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">{C.commentLabel}</span>
          <textarea name="comment" rows={3} maxLength={1000} className="field h-auto py-3" />
        </label>
        <button type="submit" className="btn-primary h-[52px] px-6">
          {C.button(end)}
        </button>
      </form>
      <Link href={href("/app/abonnement")} className="btn-link">
        {C.back}
      </Link>
    </div>
  );
}
