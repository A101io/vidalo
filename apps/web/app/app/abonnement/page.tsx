import { getI18n } from "@/lib/i18n";
import { isVerifiedOwner } from "@vidalo/core/shared";
import { Stip } from "@/components/Stip";
import { requireOwner } from "@/lib/owner";
import { ready } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { dateShort } from "@/lib/format";
import Link from "next/link";
import { subscriptionOptions } from "@vidalo/core/billing";
import { longDate } from "@vidalo/core/reporter";
import { resumeAction, undoCancelAction } from "./actions";

/** Next renewal date from Stripe, when there is a subscription and a key. */
async function nextPayment(subscriptionId: string | null): Promise<string | null> {
  const stripe = subscriptionId ? await getStripe() : null;
  if (!stripe || !subscriptionId) return null;
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    // The period end moved from the subscription to its items in newer API versions; read either.
    const s = sub as unknown as { current_period_end?: number; items?: { data?: { current_period_end?: number }[] } };
    const end = s.current_period_end ?? s.items?.data?.[0]?.current_period_end;
    return end ? dateShort(new Date(end * 1000)) : null;
  } catch {
    return null;
  }
}

type Changed = "opgezegd" | "doorgaan" | "gepauzeerd" | "hervat";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ toegevoegd?: string; gewijzigd?: string; fout?: string }> }) {
  const sp = await searchParams;
  const { business, session } = await requireOwner("/app/abonnement");
  const { copy, href, lang } = await getI18n();
  const B = copy.billing;
  const M = B.manage;
  const options = subscriptionOptions(business);
  const changed = sp.gewijzigd && sp.gewijzigd in M.done ? M.done[sp.gewijzigd as Changed] : null;
  const events = await (await ready()).listEvents(business.id, 200);
  const lastPay = events.find((e) => e.type === "payment.processing" || e.type === "checkout.completed" || e.type === "checkout.mock");
  const processing = lastPay?.type === "payment.processing";
  const next = await nextPayment(business.stripeSubscriptionId);
  const tone = business.status === "paused" ? "rood" : business.status === "trial" || business.status === "active" ? "groen" : "grijs";
  const canAdd = business.plan === "setup" && (business.status === "trial" || business.status === "active") && isVerifiedOwner(business, session.userId);
  return (
    <div className="space-y-6">
      <h1 className="h2">{B.h1}</h1>
      {sp.toegevoegd === "1" && (
        <p className="card p-4 text-[15px]" aria-live="polite">
          {copy.billing.addonDone}
        </p>
      )}
      {(changed || sp.fout === "1") && (
        <p className={`card p-4 text-[15px] ${changed ? "" : "text-rood"}`} aria-live="polite">
          {changed ?? M.error}
        </p>
      )}
      {(processing || business.status === "paused") && (
        <p className="rounded-2xl bg-panel p-4 text-[15px] text-ink-2" aria-live="polite">
          {processing ? B.processing : B.pausedNote}
        </p>
      )}
      <section className="card divide-y-[1.5px] divide-line">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <span className="text-[14px] text-muted">{B.planLabel}</span>
          <span className="font-semibold">{B.plans[business.plan]}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <span className="text-[14px] text-muted">{B.statusLabel}</span>
          <span className="inline-flex items-center gap-2 font-semibold">
            <Stip tone={tone} /> {B.statuses[business.status]}
          </span>
        </div>
        {next && !options.canUndoCancel && !options.canResume && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-5">
            <span className="text-[14px] text-muted">{B.nextLabel}</span>
            <span className="font-semibold">{next}</span>
          </div>
        )}
        {options.canUndoCancel && business.cancelAt && (
          <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="text-[14px] text-muted">{M.cancelledRow}</span> <span className="font-semibold">{longDate(business.cancelAt, lang)}</span>
              <p className="mt-1 max-w-[52ch] text-[15px] text-ink-2">{M.cancelledNote(longDate(business.cancelAt, lang))}</p>
            </div>
            <form action={undoCancelAction}>
              <button type="submit" className="btn-sm">
                {M.undo}
              </button>
            </form>
          </div>
        )}
        {options.canResume && business.pauseUntil && (
          <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="text-[14px] text-muted">{M.pausedRow}</span> <span className="font-semibold">{longDate(business.pauseUntil, lang)}</span>
              <p className="mt-1 max-w-[52ch] text-[15px] text-ink-2">{M.pausedNote(longDate(business.pauseUntil, lang))}</p>
            </div>
            <form action={resumeAction}>
              <button type="submit" className="btn-sm">
                {M.resume}
              </button>
            </form>
          </div>
        )}
      </section>
      {canAdd && (
        <section className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="h3">{B.addonTitle}</h2>
            <p className="mt-1 max-w-[52ch] text-[15px] text-ink-2">{B.addonBody}</p>
          </div>
          <form action="/api/checkout" method="post">
            <input type="hidden" name="business" value={business.id} />
            <input type="hidden" name="plan" value="monitor_addon" />
            <button type="submit" className="btn-primary h-[52px] px-6">
              {B.addonButton}
            </button>
          </form>
        </section>
      )}
      {(options.canPause || options.canCancel) && (
        <section className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="h3">{M.title}</h2>
            <p className="mt-1 max-w-[52ch] text-[15px] text-muted">{M.body}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {options.canPause && (
              <Link href={href("/app/abonnement/pauzeren")} className="btn-sm">
                {M.pauseLink}
              </Link>
            )}
            {options.canCancel && (
              <Link href={href("/app/abonnement/opzeggen")} className="btn-sm">
                {M.cancelLink}
              </Link>
            )}
          </div>
        </section>
      )}
      {business.plan !== "none" && (
        <section className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="h3">{B.portal}</h2>
            <p className="mt-1 max-w-[52ch] text-[15px] text-muted">{B.portalNote}</p>
          </div>
          <form action="/api/billing/portal" method="post">
            <button type="submit" className="btn-sm">
              {copy.dashboard.openPortal}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
