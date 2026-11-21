"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { PRODUCT_LINE_LIMITS, parseProductLine, type ProductLineFieldError, type ProductLineFormInput } from "@vidalo/core/shared/product-lines";
import { copyFor, type Lang } from "@vidalo/core/copy";
import { saveProductLine } from "./actions";

type ErrorCopy = Record<string, Record<string, string | ((n: number) => string)>>;
const FIELD_ORDER = ["name", "category", "useCases", "markets", "specs", "certificates", "outlets", "replaces", "replacedBy"] as const;
const MAX_FOR = { useCases: PRODUCT_LINE_LIMITS.useCases, markets: PRODUCT_LINE_LIMITS.marketsPerLine, specs: PRODUCT_LINE_LIMITS.specs, certificates: PRODUCT_LINE_LIMITS.certificates, outlets: PRODUCT_LINE_LIMITS.outletsPerMarket, replaces: PRODUCT_LINE_LIMITS.replaces } as Record<string, number>;

/** Which control of an outlet row an error is about: the checked market, the URL (reason "invalid" only comes from the URL), or the name. */
const outletPart = (reason: ProductLineFieldError["reason"]): "market" | "url" | "name" => (reason === "outside_markets" || reason === "too_many" ? "market" : reason === "invalid" ? "url" : "name");

/** The id of the control the first error is about, so focus can go there. */
function targetId(e: ProductLineFieldError): string {
  const i = e.index;
  switch (e.field) {
    case "markets":
      return "g-markets";
    case "specs":
      return i === undefined ? "g-specs" : `f-spec-${i}-label`;
    case "certificates":
      return i === undefined ? "g-certs" : `f-cert-${i}-name`;
    case "outlets":
      return i === undefined ? "g-outlets" : `f-outlet-${i}-${outletPart(e.reason)}`;
    default:
      return `f-${e.field}`;
  }
}

/** The id of the message of an error (a field, or one row of a group). */
const messageId = (e: { field: string; index?: number }) => `e-${e.field}${e.index === undefined ? "" : `-${e.index}`}`;

function Field({ id, label, hint, hintId, required, copy, children }: { id: string; label: string; hint?: string; hintId?: string; required?: boolean; copy: { required: string; optional: string }; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label} <span className="font-normal text-muted">· {required ? copy.required : copy.optional}</span>
      </label>
      {hint && (
        <p id={hintId} className="mb-1.5 mt-0 text-[13px] text-muted">
          {hint}
        </p>
      )}
      {children}
    </div>
  );
}

export function LineForm({
  lang,
  businessId,
  lineId,
  initial,
  marketOptions,
  cancelHref,
  disputed,
  urlError,
  title,
}: {
  lang: Lang;
  businessId: string;
  lineId: string | null;
  initial: ProductLineFormInput;
  marketOptions: { code: string; name: string }[];
  cancelHref: string;
  disputed: boolean;
  /** ?fout= from a redirect, already allow-listed by the page: shown at its field like any other error */
  urlError: ProductLineFieldError | null;
  title: string;
}) {
  const P = copyFor(lang).productLines;
  const F = P.form;
  const E = P.errors as unknown as ErrorCopy;
  const [state, formAction, pending] = useActionState(saveProductLine, null);
  // What was typed. After a server answer it is what the server read, so a refusal never empties the form (WCAG 3.3.7).
  const [v, setV] = useState<ProductLineFormInput>(state?.values ?? initial);
  const [clientErrors, setClientErrors] = useState<ProductLineFieldError[] | null>(null);
  const attempted = useRef(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const errors: ProductLineFieldError[] = clientErrors ?? state?.fields ?? (urlError ? [urlError] : []);
  const limitHit = !clientErrors && Boolean(state?.limit);

  const set = <K extends keyof ProductLineFormInput>(key: K, value: ProductLineFormInput[K]) => setV((cur) => ({ ...cur, [key]: value }));

  // Focus the first error after a submit, or the control a row button just made.
  useEffect(() => {
    if (!attempted.current || !errors.length) return;
    const first = [...errors].sort((a, b) => FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field) || (a.index ?? -1) - (b.index ?? -1))[0]!;
    document.getElementById(targetId(first))?.focus();
  }, [clientErrors, state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focusId) return;
    document.getElementById(focusId)?.focus();
    setFocusId(null);
  }, [focusId]);

  const sortedErrors = [...errors].sort((a, b) => FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field) || (a.index ?? -1) - (b.index ?? -1));

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    attempted.current = true;
    const parsed = parseProductLine(v);
    if (parsed.ok) {
      setClientErrors(null);
      return; // the server stays authoritative: the form posts as it is
    }
    e.preventDefault();
    setClientErrors(parsed.errors);
  };

  const sentence = (e: ProductLineFieldError): string => {
    const forField = Object.hasOwn(E, e.field) ? E[e.field]! : {};
    const t = Object.hasOwn(forField, e.reason) ? forField[e.reason]! : null;
    const text = t === null ? "" : typeof t === "function" ? t(MAX_FOR[e.field] ?? 1) : t;
    // Lines of a textarea are named by their number; rows of a group by their own legend.
    return e.index !== undefined && (e.field === "useCases" || e.field === "replaces") ? `${P.rowPrefix(e.index + 1)}: ${text}` : text;
  };
  const errorsOf = (field: string, index?: number) => errors.filter((e) => e.field === field && e.index === index);
  const rowErrors = (field: string, index: number) => errors.filter((e) => e.field === field && e.index === index);
  const outletErrors = (i: number, part: "market" | "url" | "name") => errors.filter((e) => e.field === "outlets" && e.index === i && outletPart(e.reason) === part);
  const Err = ({ field, index }: { field: string; index?: number }) => {
    const list = errorsOf(field, index);
    if (!list.length) return null;
    return (
      <div id={messageId({ field, index })} className="mt-1.5 flex flex-col gap-1">
        {list.map((e, i) => (
          <p key={i} className="m-0 text-[14px] font-semibold text-rood">
            {sentence(e)}
          </p>
        ))}
      </div>
    );
  };
  const describedBy = (field: string, index?: number, hintId?: string) => [errorsOf(field, index).length ? messageId({ field, index }) : null, hintId].filter(Boolean).join(" ") || undefined;
  const invalid = (field: string, index?: number) => (errorsOf(field, index).length ? true : undefined);

  // markets
  const maxMarkets = PRODUCT_LINE_LIMITS.marketsPerLine;
  const chosen = v.markets;
  const toggleMarket = (code: string, on: boolean) => set("markets", on ? [...chosen, code] : chosen.filter((c) => c !== code));
  const marketName = (code: string) => marketOptions.find((m) => m.code === code)?.name ?? code;

  // rows
  const addSpec = () => {
    set("specs", [...v.specs, { label: "", value: "" }]);
    setFocusId(`f-spec-${v.specs.length}-label`);
  };
  const addCert = () => {
    set("certificates", [...v.certificates, { name: "", number: "", validUntil: "" }]);
    setFocusId(`f-cert-${v.certificates.length}-name`);
  };
  const outletsIn = (m: string) => v.outlets.filter((o) => o.market === m).length;
  const nextOutletMarket = chosen.find((m) => outletsIn(m) < PRODUCT_LINE_LIMITS.outletsPerMarket) ?? null;
  const addOutlet = () => {
    if (!nextOutletMarket) return;
    set("outlets", [...v.outlets, { market: nextOutletMarket, name: "", url: "" }]);
    setFocusId(`f-outlet-${v.outlets.length}-name`);
  };

  const rowBox = "flex flex-col gap-3 rounded-[12px] border-[1.5px] border-line p-4";
  const removeBtn = "inline-flex h-11 min-w-11 items-center justify-center self-start rounded-btn px-3 text-[14px] font-semibold text-muted underline underline-offset-[3px] hover:text-rood";
  const addBtn = "btn-sm self-start";

  return (
    <form action={formAction} onSubmit={onSubmit} noValidate className="card flex flex-col gap-8 p-5 sm:p-8" aria-labelledby="line-form-title">
      <input type="hidden" name="business" value={businessId} />
      <input type="hidden" name="line" value={lineId ?? ""} />
      <div>
        <h2 id="line-form-title" className="h3 m-0">
          {title}
        </h2>
        {disputed && <p className="mb-0 mt-3 rounded-xl bg-panel px-4 py-3 text-[15px]">{F.disputed}</p>}
        {lineId && <p className="mb-0 mt-3 text-[14px] text-muted">{F.newerVersion}</p>}
      </div>

      {(errors.length > 0 || limitHit) && (
        <div role="alert" id="error-summary" tabIndex={-1} {...{ autofocus: "" }} className="rounded-xl border-[1.5px] border-rood bg-white px-4 py-3 text-[15px]">
          <p className="m-0 font-semibold">{limitHit ? P.limitError(PRODUCT_LINE_LIMITS.lines) : P.errorSummary(errors.length)}</p>
          {!limitHit && (
            <ul className="mb-0 mt-2 flex list-none flex-col gap-1 p-0">
              {sortedErrors.map((e, i) => (
                <li key={i}>
                  <a href={`#${targetId(e)}`} className="inline-flex min-h-11 items-center font-semibold text-rood underline underline-offset-[3px]">
                    {sentence(e)}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Field id="f-name" label={F.name} hint={F.nameHint} hintId="h-name" required copy={F}>
        <input id="f-name" name="name" type="text" value={v.name} onChange={(e) => set("name", e.target.value)} maxLength={120} autoComplete="off" aria-required="true" aria-invalid={invalid("name")} aria-describedby={describedBy("name", undefined, "h-name")} className="field-sm" />
        <Err field="name" />
      </Field>

      <Field id="f-category" label={F.category} hint={F.categoryHint} hintId="h-category" required copy={F}>
        <input id="f-category" name="category" type="text" value={v.category} onChange={(e) => set("category", e.target.value)} maxLength={100} autoComplete="off" aria-required="true" aria-invalid={invalid("category")} aria-describedby={describedBy("category", undefined, "h-category")} className="field-sm" />
        <Err field="category" />
      </Field>

      <Field id="f-useCases" label={F.useCases} hint={F.useCasesHint(PRODUCT_LINE_LIMITS.useCases)} hintId="h-useCases" copy={F}>
        <textarea id="f-useCases" name="useCases" rows={3} value={v.useCases} onChange={(e) => set("useCases", e.target.value)} aria-invalid={invalid("useCases") ?? (errors.some((e) => e.field === "useCases") ? true : undefined)} aria-describedby={[errors.some((e) => e.field === "useCases") ? "e-useCases-all" : null, "h-useCases"].filter(Boolean).join(" ")} className="field-sm h-auto py-2" />
        <div id="e-useCases-all" className="flex flex-col gap-1">
          {errors.filter((e) => e.field === "useCases").map((e, i) => (
            <p key={i} className="mb-0 mt-1.5 text-[14px] font-semibold text-rood">
              {sentence(e)}
            </p>
          ))}
        </div>
      </Field>

      <fieldset id="g-markets" tabIndex={-1} className="m-0 flex flex-col gap-3 border-0 p-0" aria-describedby={["h-markets", errors.some((e) => e.field === "markets") ? "e-markets-all" : null].filter(Boolean).join(" ")}>
        <legend className="field-label mb-1.5 p-0">
          {F.markets} <span className="font-normal text-muted">· {F.required}</span>
        </legend>
        <p id="h-markets" className="m-0 text-[13px] text-muted">
          {F.marketsHint(maxMarkets)} <span aria-live="polite">{F.marketsCount(chosen.length, maxMarkets)}</span>
        </p>
        <div className="grid gap-x-4 sm:grid-cols-2">
          {marketOptions.map((m, i) => {
            const on = chosen.includes(m.code);
            const atMax = !on && chosen.length >= maxMarkets;
            return (
              <label key={m.code} className={`flex min-h-11 items-center gap-3 text-[15px] ${atMax ? "text-muted" : ""}`}>
                <input id={i === 0 ? "f-market-0" : undefined} type="checkbox" name="markets" value={m.code} checked={on} disabled={atMax} onChange={(e) => toggleMarket(m.code, e.target.checked)} className="h-5 w-5 shrink-0 accent-blue" />
                {m.name}
              </label>
            );
          })}
        </div>
        <div id="e-markets-all">
          {errors.filter((e) => e.field === "markets").map((e, i) => (
            <p key={i} className="m-0 text-[14px] font-semibold text-rood">
              {sentence(e)}
            </p>
          ))}
        </div>
      </fieldset>

      <fieldset id="g-specs" tabIndex={-1} className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="field-label mb-1.5 p-0">
          {F.specs} <span className="font-normal text-muted">· {F.optional}</span>
        </legend>
        <p className="m-0 text-[13px] text-muted">{F.specsHint(PRODUCT_LINE_LIMITS.specs)}</p>
        {errors.filter((e) => e.field === "specs" && e.index === undefined).map((e, i) => (
          <p key={i} className="m-0 text-[14px] font-semibold text-rood">
            {sentence(e)}
          </p>
        ))}
        {v.specs.map((row, i) => (
          <fieldset key={i} className={`${rowBox} m-0`}>
            <legend className="px-1 text-[14px] font-bold">{F.specGroup(i + 1)}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`f-spec-${i}-label`} className="field-label">
                  {F.specLabel}
                </label>
                <input id={`f-spec-${i}-label`} name={`spec.${i}.label`} type="text" value={row.label} onChange={(e) => set("specs", v.specs.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))} maxLength={80} autoComplete="off" aria-invalid={rowErrors("specs", i).length ? true : undefined} aria-describedby={rowErrors("specs", i).length ? messageId({ field: "specs", index: i }) : undefined} className="field-sm" />
              </div>
              <div>
                <label htmlFor={`f-spec-${i}-value`} className="field-label">
                  {F.specValue}
                </label>
                <input id={`f-spec-${i}-value`} name={`spec.${i}.value`} type="text" value={row.value} onChange={(e) => set("specs", v.specs.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))} maxLength={120} autoComplete="off" aria-invalid={rowErrors("specs", i).length ? true : undefined} aria-describedby={rowErrors("specs", i).length ? messageId({ field: "specs", index: i }) : undefined} className="field-sm" />
              </div>
            </div>
            <Err field="specs" index={i} />
            <button type="button" className={removeBtn} onClick={() => { set("specs", v.specs.filter((_, j) => j !== i)); setFocusId("b-add-spec"); }} aria-label={F.remove(F.specGroup(i + 1))}>
              {F.remove(F.specGroup(i + 1))}
            </button>
          </fieldset>
        ))}
        {v.specs.length < PRODUCT_LINE_LIMITS.specs ? (
          <button id="b-add-spec" type="button" className={addBtn} onClick={addSpec}>
            {F.add(F.addSpec)}
          </button>
        ) : (
          <p id="b-add-spec" tabIndex={-1} className="m-0 text-[14px] text-muted">
            {F.maxReached(F.maxSpecs, PRODUCT_LINE_LIMITS.specs)}
          </p>
        )}
      </fieldset>

      <fieldset id="g-certs" tabIndex={-1} className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="field-label mb-1.5 p-0">
          {F.certificates} <span className="font-normal text-muted">· {F.optional}</span>
        </legend>
        <p className="m-0 text-[13px] text-muted">{F.certificatesHint(PRODUCT_LINE_LIMITS.certificates)}</p>
        {errors.filter((e) => e.field === "certificates" && e.index === undefined).map((e, i) => (
          <p key={i} className="m-0 text-[14px] font-semibold text-rood">
            {sentence(e)}
          </p>
        ))}
        {v.certificates.map((row, i) => (
          <fieldset key={i} className={`${rowBox} m-0`}>
            <legend className="px-1 text-[14px] font-bold">{F.certGroup(i + 1)}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor={`f-cert-${i}-name`} className="field-label">
                  {F.certName}
                </label>
                <input id={`f-cert-${i}-name`} name={`cert.${i}.name`} type="text" value={row.name} onChange={(e) => set("certificates", v.certificates.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} maxLength={100} autoComplete="off" aria-invalid={rowErrors("certificates", i).length ? true : undefined} aria-describedby={rowErrors("certificates", i).length ? messageId({ field: "certificates", index: i }) : undefined} className="field-sm" />
              </div>
              <div>
                <label htmlFor={`f-cert-${i}-number`} className="field-label">
                  {F.certNumber}
                </label>
                <input id={`f-cert-${i}-number`} name={`cert.${i}.number`} type="text" value={row.number} onChange={(e) => set("certificates", v.certificates.map((r, j) => (j === i ? { ...r, number: e.target.value } : r)))} maxLength={80} autoComplete="off" className="field-sm" />
              </div>
              <div>
                <label htmlFor={`f-cert-${i}-until`} className="field-label">
                  {F.certUntil}
                </label>
                <input id={`f-cert-${i}-until`} name={`cert.${i}.validUntil`} type="date" value={row.validUntil} onChange={(e) => set("certificates", v.certificates.map((r, j) => (j === i ? { ...r, validUntil: e.target.value } : r)))} aria-describedby={`h-cert-${i}-until`} className="field-sm" />
                <p id={`h-cert-${i}-until`} className="mb-0 mt-1 text-[13px] text-muted">
                  {F.certUntilHint}
                </p>
              </div>
            </div>
            <Err field="certificates" index={i} />
            <button type="button" className={removeBtn} onClick={() => { set("certificates", v.certificates.filter((_, j) => j !== i)); setFocusId("b-add-cert"); }} aria-label={F.remove(F.certGroup(i + 1))}>
              {F.remove(F.certGroup(i + 1))}
            </button>
          </fieldset>
        ))}
        {v.certificates.length < PRODUCT_LINE_LIMITS.certificates ? (
          <button id="b-add-cert" type="button" className={addBtn} onClick={addCert}>
            {F.add(F.addCert)}
          </button>
        ) : (
          <p id="b-add-cert" tabIndex={-1} className="m-0 text-[14px] text-muted">
            {F.maxReached(F.maxCerts, PRODUCT_LINE_LIMITS.certificates)}
          </p>
        )}
      </fieldset>

      <fieldset id="g-outlets" tabIndex={-1} className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="field-label mb-1.5 p-0">
          {F.outlets} <span className="font-normal text-muted">· {F.optional}</span>
        </legend>
        <p className="m-0 text-[13px] text-muted">{F.outletsHint(PRODUCT_LINE_LIMITS.outletsPerMarket)}</p>
        {errors.filter((e) => e.field === "outlets" && e.index === undefined).map((e, i) => (
          <p key={i} className="m-0 text-[14px] font-semibold text-rood">
            {sentence(e)}
          </p>
        ))}
        {chosen.length === 0 && v.outlets.length === 0 && <p className="m-0 text-[14px] text-muted">{F.outletsNeedMarket}</p>}
        {v.outlets.map((row, i) => {
          const options = chosen.includes(row.market) ? chosen : [...chosen, row.market];
          return (
            <fieldset key={i} className={`${rowBox} m-0`}>
              <legend className="px-1 text-[14px] font-bold">{F.outletGroup(i + 1)}</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor={`f-outlet-${i}-market`} className="field-label">
                    {F.outletMarket}
                  </label>
                  <select id={`f-outlet-${i}-market`} name={`outlet.${i}.market`} value={row.market} onChange={(e) => set("outlets", v.outlets.map((r, j) => (j === i ? { ...r, market: e.target.value } : r)))} aria-invalid={outletErrors(i, "market").length ? true : undefined} aria-describedby={outletErrors(i, "market").length ? messageId({ field: "outlets", index: i }) : undefined} className="field-sm">
                    {options.map((c) => (
                      <option key={c} value={c}>
                        {marketName(c)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`f-outlet-${i}-name`} className="field-label">
                    {F.outletName}
                  </label>
                  <input id={`f-outlet-${i}-name`} name={`outlet.${i}.name`} type="text" value={row.name} onChange={(e) => set("outlets", v.outlets.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} maxLength={160} autoComplete="off" aria-invalid={outletErrors(i, "name").length ? true : undefined} aria-describedby={outletErrors(i, "name").length ? messageId({ field: "outlets", index: i }) : undefined} className="field-sm" />
                </div>
                <div>
                  <label htmlFor={`f-outlet-${i}-url`} className="field-label">
                    {F.outletUrl}
                  </label>
                  <input id={`f-outlet-${i}-url`} name={`outlet.${i}.url`} type="text" inputMode="url" value={row.url} onChange={(e) => set("outlets", v.outlets.map((r, j) => (j === i ? { ...r, url: e.target.value } : r)))} maxLength={400} autoComplete="off" aria-invalid={outletErrors(i, "url").length ? true : undefined} aria-describedby={[outletErrors(i, "url").length ? messageId({ field: "outlets", index: i }) : null, `h-outlet-${i}-url`].filter(Boolean).join(" ")} className="field-sm" />
                  <p id={`h-outlet-${i}-url`} className="mb-0 mt-1 text-[13px] text-muted">
                    {F.outletUrlHint}
                  </p>
                </div>
              </div>
              <Err field="outlets" index={i} />
              <button type="button" className={removeBtn} onClick={() => { set("outlets", v.outlets.filter((_, j) => j !== i)); setFocusId("b-add-outlet"); }} aria-label={F.remove(F.outletGroup(i + 1))}>
                {F.remove(F.outletGroup(i + 1))}
              </button>
            </fieldset>
          );
        })}
        {nextOutletMarket ? (
          <button id="b-add-outlet" type="button" className={addBtn} onClick={addOutlet}>
            {F.add(F.addOutlet)}
          </button>
        ) : chosen.length > 0 ? (
          <p id="b-add-outlet" tabIndex={-1} className="m-0 text-[14px] text-muted">
            {F.maxReached(F.maxOutlets, PRODUCT_LINE_LIMITS.outletsPerMarket)}
          </p>
        ) : null}
      </fieldset>

      <Field id="f-replaces" label={F.replaces} hint={F.replacesHint(PRODUCT_LINE_LIMITS.replaces)} hintId="h-replaces" copy={F}>
        <textarea id="f-replaces" name="replaces" rows={2} value={v.replaces} onChange={(e) => set("replaces", e.target.value)} aria-invalid={errors.some((e) => e.field === "replaces") ? true : undefined} aria-describedby={[errors.some((e) => e.field === "replaces") ? "e-replaces-all" : null, "h-replaces"].filter(Boolean).join(" ")} className="field-sm h-auto py-2" />
        <div id="e-replaces-all">
          {errors.filter((e) => e.field === "replaces").map((e, i) => (
            <p key={i} className="mb-0 mt-1.5 text-[14px] font-semibold text-rood">
              {sentence(e)}
            </p>
          ))}
        </div>
      </Field>

      <Field id="f-replacedBy" label={F.replacedBy} hint={F.replacedByHint} hintId="h-replacedBy" copy={F}>
        <input id="f-replacedBy" name="replacedBy" type="text" value={v.replacedBy} onChange={(e) => set("replacedBy", e.target.value)} maxLength={160} autoComplete="off" aria-invalid={invalid("replacedBy")} aria-describedby={describedBy("replacedBy", undefined, "h-replacedBy")} className="field-sm" />
        <Err field="replacedBy" />
      </Field>

      <div className="flex flex-col gap-4 border-t-[1.5px] border-ink pt-6">
        <p className="m-0 max-w-[640px] text-[15px] font-semibold" id="confirm-sentence">
          {F.confirm}
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <button type="submit" disabled={pending} aria-describedby="confirm-sentence" className="btn-primary h-[52px] px-6">
            {F.submit}
          </button>
          <Link href={cancelHref} className="inline-flex h-11 items-center text-[15px] font-semibold text-muted underline underline-offset-[3px] hover:text-blue">
            {P.cancel}
          </Link>
        </div>
      </div>
    </form>
  );
}
