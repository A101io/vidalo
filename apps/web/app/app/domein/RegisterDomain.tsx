import type { BusinessRecord } from "@vidalo/core/db";
import type { CopyShape, Lang } from "@vidalo/core/copy";
import { DOMAIN_PRICE_EUR_PER_YEAR, domainBuyRefusal, domainOptions, domainState, inclVat } from "@vidalo/core/billing";
import { factsHostOn, getRegistrar, holderDraft, parseDomain, suggestDomains, tldAllowed, HOLDER_FIELDS, type Availability } from "@vidalo/core/registrar";
import { longDate } from "@vidalo/core/reporter";
import { ready } from "@/lib/core";
import { Stip, type Tone } from "@/components/Stip";
import { cancelDomainAction, mailAuthCodeAction, undoDomainCancelAction } from "../actions";

type R = CopyShape["domain"]["register"];
const euro = (n: number, lang: Lang) => n.toLocaleString(lang === "en" ? "en-GB" : "nl-NL", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

export interface RegisterParams {
  naam?: string;
  fout?: string;
  domein?: string;
}

/**
 * Option B: Vidalo registers a domain (the paid add-on, docs/DOMAINS.md).
 * Before purchase: a suggested name checked at the registrar, alternatives,
 * the price, who owns it, the refund rule, the holder's details and the terms
 * box, then Stripe Checkout. After: requested → registered → live.
 */
/** `primary`: false when option A already shows the blue button (one primary button per view). */
export async function RegisterDomain({ business, sp, R, lang, href, primary }: { business: BusinessRecord; sp: RegisterParams; R: R; lang: Lang; href: (h: string) => string; primary: boolean }) {
  const state = domainState(business);
  const reg = business.domainRegistration;
  const date = (iso: string | null) => (iso ? longDate(iso, lang) : "");

  if (reg && state !== "none" && state !== "checkout") {
    const steps: { key: keyof R["steps"]; done: boolean }[] = [
      { key: "requested", done: true },
      { key: "registered", done: state === "registered" || state === "live" || state === "ended" },
      { key: "live", done: state === "live" },
    ];
    const opts = domainOptions(reg);
    const host = factsHostOn(reg.name);
    return (
      <section id="registreren" className="card p-5 sm:p-6">
        <h2 className="h3">{R.statusH(reg.name)}</h2>
        {state !== "failed" && (
          <ol className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[15px]" aria-label={R.statusH(reg.name)}>
            {steps.map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                <Stip tone={(s.done ? "groen" : "grijs") as Tone} />
                <span className={s.done ? "" : "text-muted"}>{R.steps[s.key]}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-[15px]">
          {state === "requested" && R.states.requested}
          {state === "registered" && R.states.registered(host)}
          {state === "live" && R.states.live(host)}
          {state === "failed" && R.states.failed}
          {state === "ended" && R.states.ended(date(reg.expiresAt))}
        </p>
        {reg.status === "registered" && reg.expiresAt && (
          <p className="mt-1 text-[14px] text-ink-2">{reg.cancelAt ? R.endsOn(date(reg.cancelAt)) : R.renews(date(reg.expiresAt), euro(DOMAIN_PRICE_EUR_PER_YEAR, lang))}</p>
        )}
        {sp.domein === "opgezegd" && reg.cancelAt && <p className="mt-3 text-[14px]">{R.cancelDone(date(reg.cancelAt))}</p>}
        {sp.domein === "verlengd" && <p className="mt-3 text-[14px]">{R.undoDone}</p>}
        {sp.domein === "code" && <p className="mt-3 text-[14px]">{R.authCodeSent}</p>}
        {sp.domein === "nee" && <p className="mt-3 text-[14px] text-rood">{R.notAllowed}</p>}
        {(opts.canCancel || opts.canUndoCancel || opts.canGetAuthCode) && (
          <div className="mt-4 flex flex-wrap gap-3">
            {opts.canGetAuthCode && (
              <form action={mailAuthCodeAction}>
                <button type="submit" className="btn-sm">
                  {R.authCode}
                </button>
              </form>
            )}
            {opts.canCancel && (
              <form action={cancelDomainAction}>
                <button type="submit" className="btn-sm">
                  {R.cancel}
                </button>
              </form>
            )}
            {opts.canUndoCancel && (
              <form action={undoDomainCancelAction}>
                <button type="submit" className="btn-sm">
                  {R.undo}
                </button>
              </form>
            )}
          </div>
        )}
      </section>
    );
  }

  const refusal = domainBuyRefusal(business);
  const registrar = getRegistrar();
  const blocked = refusal === "own_domain_live" ? R.ownLive : refusal === "not_paying" ? R.notPaying : !registrar || refusal ? R.unavailable : null;
  if (blocked || !registrar) {
    return (
      <section id="registreren" className="card p-5 sm:p-6">
        <h2 className="h3">{R.h2}</h2>
        <p className="mt-2 text-[15px] text-muted">{blocked}</p>
      </section>
    );
  }

  const suggestions = suggestDomains(business.name, business.place, 6, business.country);
  const parsed = sp.naam ? parseDomain(sp.naam) : null;
  const typed = parsed && tldAllowed(parsed.tld, business.country) ? parsed : null;
  const asked = typed?.name ?? suggestions[0] ?? null;
  let checked: Availability[] = [];
  let checkFailed = false;
  if (asked && !(sp.naam && !typed)) {
    try {
      checked = await registrar.check([asked, ...suggestions.filter((s) => s !== asked)]);
    } catch {
      checkFailed = true;
    }
  }
  const main = checked[0];
  const free = checked.slice(1).filter((a) => a.available);
  const facts = main?.available ? await (await ready()).latestFacts(business.id) : null;
  const draft = holderDraft(business, facts);
  const error = sp.fout && sp.fout in R.errors ? R.errors[sp.fout as keyof R["errors"]] : sp.fout === "ongeldig" ? R.invalid : null;
  const excl = euro(DOMAIN_PRICE_EUR_PER_YEAR, lang);
  const incl = euro(inclVat(DOMAIN_PRICE_EUR_PER_YEAR), lang);

  return (
    <section id="registreren" className="card p-5 sm:p-6">
      <h2 className="h3">{R.h2}</h2>
      <p className="mt-2 max-w-[60ch] text-[15px]">{R.intro}</p>
      {sp.domein === "geannuleerd" && <p className="mt-3 text-[15px] text-muted">{R.cancelledCheckout}</p>}

      <form method="get" action={href("/app/domein#registreren")} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-[240px] flex-1">
          <span className="field-label">{R.nameLabel}</span>
          <input name="naam" defaultValue={sp.naam ?? asked ?? ""} className="field-sm" autoComplete="off" spellCheck={false} aria-describedby="naam-hint" />
          <span id="naam-hint" className="mt-1 block text-[13px] text-muted">
            {R.nameHint}
          </span>
        </label>
        <button type="submit" className="btn-sm mb-[22px]">
          {R.checkButton}
        </button>
      </form>

      {sp.naam && !typed && <p className="mt-3 text-[15px] text-rood">{R.invalid}</p>}
      {checkFailed && <p className="mt-3 text-[15px] text-rood">{R.errors.checkout}</p>}

      {main && !main.available && (
        <div className="mt-4 text-[15px]">
          <p className="flex items-center gap-2">
            <Stip tone="rood" /> {R.taken(main.name)}
          </p>
          {free.length ? (
            <>
              <p className="mt-3">{R.alternatives}</p>
              <ul className="mt-2 space-y-2">
                {free.map((a) => (
                  <li key={a.name} className="flex items-center gap-3">
                    <Stip tone="groen" />
                    <span className="flex-1 break-all">{a.name}</span>
                    <a className="btn-link" href={href(`/app/domein?naam=${encodeURIComponent(a.name)}#registreren`)}>
                      {R.choose}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-3 text-muted">{R.noAlternatives}</p>
          )}
        </div>
      )}

      {main?.available && (
        <form action="/api/domain/checkout" method="post" className="mt-5 space-y-4 border-t-[1.5px] border-line pt-5 text-[15px]">
          <input type="hidden" name="domain" value={main.name} />
          <p className="flex items-center gap-2 font-bold">
            <Stip tone="groen" /> {R.available(main.name)}
          </p>
          <p>{R.price(excl, incl)}</p>
          <p>{R.ownership(main.name)}</p>
          <p>{R.refund}</p>
          <p className="text-ink-2">{R.apex(main.name)}</p>

          <fieldset className="space-y-3">
            <legend className="font-bold">{R.holderH}</legend>
            <p className="text-[14px] text-ink-2">{R.holderNote}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {HOLDER_FIELDS.map((k) => (
                <label key={k} className={k === "company" || k === "email" ? "sm:col-span-2" : ""}>
                  <span className="field-label">{R.fields[k]}</span>
                  {k === "email" && <span className="mb-1.5 block text-[13px] text-muted">{R.emailHint}</span>}
                  <input
                    name={k}
                    defaultValue={draft[k]}
                    required
                    className="field-sm"
                    type={k === "email" ? "email" : k === "phone" ? "tel" : "text"}
                    autoComplete={{ company: "organization", firstName: "given-name", lastName: "family-name", street: "address-line1", houseNumber: "off", postcode: "postal-code", city: "address-level2", phone: "tel", email: "email" }[k]}
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex items-start gap-2">
            <input type="checkbox" name="accept" value="ja" required className="mt-1" />
            <span>
              {R.accept}{" "}
              <a className="underline" href={href("/voorwaarden#domein")} target="_blank" rel="noopener">
                {R.acceptLink}
              </a>
            </span>
          </label>
          {error && <p className="text-rood">{error}</p>}
          <button type="submit" className={primary ? "btn-primary h-[52px]" : "btn-sm"}>
            {R.pay}
          </button>
        </form>
      )}
    </section>
  );
}
