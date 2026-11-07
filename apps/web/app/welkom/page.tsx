import Link from "next/link";
import { getI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { getSession } from "@/lib/session";
import { getStripe } from "@/lib/stripe";
import { ready } from "@/lib/db";
import { env } from "@/lib/env";
import { welcomeStepsFor } from "@vidalo/core/shared";

type PaymentState = "paid" | "processing" | "failed" | "unknown";

/** What Stripe says about this checkout; "unknown" in mock mode or without a session id. */
async function paymentState(sessionId?: string): Promise<{ state: PaymentState; amount: string | null; email: string | null; plan?: string }> {
  const stripe = sessionId ? await getStripe() : null;
  if (!stripe || !sessionId) return { state: "unknown", amount: null, email: null };
  try {
    const s = await stripe.checkout.sessions.retrieve(sessionId);
    const amount = s.amount_total != null ? new Intl.NumberFormat("nl-NL", { style: "currency", currency: (s.currency ?? "eur").toUpperCase() }).format(s.amount_total / 100) : null;
    const email = s.customer_details?.email ?? null;
    const plan = s.metadata?.plan;
    if (s.payment_status === "paid" || s.payment_status === "no_payment_required") return { state: "paid", amount, email, plan };
    if (s.status === "complete") return { state: "processing", amount, email, plan };
    return { state: "failed", amount, email, plan };
  } catch {
    return { state: "unknown", amount: null, email: null };
  }
}

/**
 * Only Vidalo Monthly promises a check every month (review CMP-01). The plan
 * comes from the checkout session; in mock mode, from the business the mock
 * checkout just marked paid.
 */
async function boughtMonthly(pay: { plan?: string }, businessId?: string): Promise<boolean> {
  if (pay.plan) return pay.plan === "monitor";
  // Only when the server itself runs without Stripe (the mock checkout): `?mock=1` in the URL must not reveal a business's plan.
  if (env.hasStripe || !businessId) return false;
  const db = await ready();
  return (await db.getBusiness(businessId))?.plan === "monitor";
}

export const dynamic = "force-dynamic";

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ mock?: string; session_id?: string; business?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  const { copy, href } = await getI18n();
  const w = copy.welcome;
  const pay = await paymentState(sp.session_id);
  const steps = welcomeStepsFor(w.steps, w.lastStepScan, await boughtMonthly(pay, sp.business));
  return (
    <>
      <SiteHeader variant="minimal" />
      <main className="wrap max-w-[760px] py-12 sm:py-16">
        {sp.mock === "1" && <p className="mb-4 text-[14px] text-muted">{copy.checkout.mockNotice}</p>}
        {pay.state === "failed" ? (
          <>
            <h1 className="h2">{w.failedH1}</h1>
            <p className="lead mt-3" aria-live="polite">
              {w.failedBody}
            </p>
          </>
        ) : (
          <>
            <h1 className="h2">{pay.state === "processing" ? w.processingH1 : w.h1}</h1>
            <p className="lead mt-3">{pay.state === "processing" ? w.processingBody : w.body}</p>
            {pay.state === "paid" && pay.amount && <p className="mt-2 text-[14px] text-muted">{w.receipt(pay.amount, pay.email)}</p>}
          </>
        )}
        {pay.state !== "failed" && (
        <ol className="mt-8 divide-y-[1.5px] divide-line border-y-[1.5px] border-line">
          {steps.map((s, i) => (
            <li key={s.title} className="grid gap-3 py-5 sm:grid-cols-[44px_1fr_auto] sm:items-center sm:gap-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-[14px] font-extrabold text-white">{i + 1}</span>
              <div>
                <h2 className="h3">{s.title}</h2>
                <p className="mt-1 text-[15px] text-ink-2">{s.body}</p>
              </div>
              <Link href={href(session && !sp.business ? s.href : `/inloggen?next=${encodeURIComponent(s.href)}${sp.business ? `&business=${encodeURIComponent(sp.business)}` : ""}${sp.session_id ? `&session_id=${encodeURIComponent(sp.session_id)}` : ""}`)} className={i === 0 ? "btn-primary h-[52px]" : "btn-sm"}>
                {s.cta}
              </Link>
            </li>
          ))}
        </ol>
        )}
        {!session && <p className="mt-6 text-[14px] text-muted">{w.loginHint}</p>}
      </main>
      <SiteFooter />
    </>
  );
}
