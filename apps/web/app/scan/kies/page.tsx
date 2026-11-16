import Link from "next/link";
import { getI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ScanField } from "@/components/ScanField";
import { resolveBusiness, parseQuery } from "@/lib/core";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { kiesAllowed } from "@/lib/turnstile";
import { typedBusinessProblem } from "@vidalo/core/shared";

export const dynamic = "force-dynamic";

export default async function ChoosePage({ searchParams }: { searchParams: Promise<{ q?: string; place?: string; plaats?: string; k?: string; fout?: string; kandidaat?: string }> }) {
  const { q = "", place: placeParam, plaats, k, fout, kandidaat } = await searchParams;
  const parsed = parseQuery(q);
  const place = placeParam || parsed.place;
  // No usable e-mail address on the post: the field again, nothing looked up.
  const emailInvalid = fout === "mail";
  // No usable postcode + house number or website: the field again, nothing looked up.
  const identityInvalid = fout === "herken";
  // A lookup costs money: only after a passed check (the token from POST /api/scan), else the field to start again.
  const allowed = Boolean(q) && !emailInvalid && !identityInvalid && !typedBusinessProblem(q, place) && kiesAllowed(q, placeParam ?? "", k);
  const candidates = allowed ? await resolveBusiness(parsed.query, place) : [];
  // A website was refused on the post: the error goes next to that candidate's field. The refused value is never shown (ADR-0007).
  const websiteErrorFor = fout !== "website" ? null : kandidaat === "geen" ? "geen" : /^\d{1,2}$/.test(kandidaat ?? "") ? Number(kandidaat) : null;
  // The field for a business Google does not list and whose website nobody knows: the only place a website is asked for.
  const asksWebsite = (cand: { placeId: string | null; website: string | null }) => !cand.placeId && !cand.website;
  const onlyUnlisted = candidates.length === 1 && asksWebsite(candidates[0]!);
  const needsPlace = plaats === "1" || (candidates.length > 0 && candidates.every((c) => !c.place) && !place);
  const { copy, href } = await getI18n();
  const c = copy.scan.choose;
  return (
    <>
      <SiteHeader variant="minimal" />
      <main className="wrap max-w-[760px] py-12 sm:py-16">
        {candidates.length > 0 ? (
          <>
            <h1 className="h2">{needsPlace ? c.placeHint : onlyUnlisted ? c.websiteTitle : c.title}</h1>
            {!needsPlace && !onlyUnlisted && <p className="lead mt-3">{c.body}</p>}
            <ul className="mt-8 divide-y-[1.5px] divide-line border-y-[1.5px] border-line">
              {candidates.map((cand, i) => (
                <li key={i} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold">
                      {cand.name}
                      {cand.place ? `, ${cand.place}` : ""}
                    </p>
                    <p className="text-[14px] text-muted">{[[cand.address, cand.postcode].filter(Boolean).join(", "), cand.website?.replace(/^https?:\/\/(www\.)?/, ""), cand.kvk ? `KvK ${cand.kvk}` : null].filter(Boolean).join(" · ")}</p>
                  </div>
                  {/* The address rides in the signed cookie /api/scan set; these forms carry none. */}
                  <form action="/api/scan" method="post" className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="q" value={q} />
                    <input type="hidden" name="pick" value={i} />
                    {cand.place ? (
                      <input type="hidden" name="place" value={cand.place} />
                    ) : (
                      <div>
                        <label htmlFor={`place-${i}`} className="field-label">
                          {c.placeLabel}
                        </label>
                        <input id={`place-${i}`} name="place" required defaultValue={place ?? ""} className="field-sm w-[180px]" />
                      </div>
                    )}
                    {asksWebsite(cand) && (
                      <div className="w-full sm:w-[300px]">
                        <label htmlFor={`website-${i}`} className="field-label">
                          {c.websiteLabel}
                        </label>
                        <input
                          id={`website-${i}`}
                          name="website"
                          type="text"
                          inputMode="url"
                          autoComplete="url"
                          autoCapitalize="none"
                          spellCheck={false}
                          placeholder={c.websitePlaceholder}
                          className="field-sm"
                          aria-invalid={websiteErrorFor === i || undefined}
                          aria-describedby={websiteErrorFor === i ? `website-${i}-hint website-${i}-error` : `website-${i}-hint`}
                        />
                        <p id={`website-${i}-hint`} className="mt-1.5 text-[14px] text-muted">
                          {c.websiteHint}
                        </p>
                        {websiteErrorFor === i && (
                          <p id={`website-${i}-error`} className="mt-1.5 text-[14px] text-rood" role="alert">
                            {c.websiteError}
                          </p>
                        )}
                      </div>
                    )}
                    <TurnstileWidget />
                    <button type="submit" className="btn-sm">
                      {c.button}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            {!onlyUnlisted && (
              <section className="mt-8" aria-labelledby="unlisted-title">
                <h2 id="unlisted-title" className="font-semibold">
                  {c.unlistedTitle}
                </h2>
                <p className="mt-1 text-[14px] text-muted">{c.unlistedBody}</p>
                {/* None of these: checked by the typed name, place and (if given) website; never one of Google's guesses. */}
                <form action="/api/scan" method="post" className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="q" value={q} />
                  <input type="hidden" name="unlisted" value="1" />
                  {place ? (
                    <input type="hidden" name="place" value={place} />
                  ) : (
                    <div>
                      <label htmlFor="place-geen" className="field-label">
                        {c.placeLabel}
                      </label>
                      <input id="place-geen" name="place" required className="field-sm w-[180px]" />
                    </div>
                  )}
                  <div className="w-full sm:w-[300px]">
                    <label htmlFor="website-geen" className="field-label">
                      {c.websiteLabel}
                    </label>
                    <input
                      id="website-geen"
                      name="website"
                      type="text"
                      inputMode="url"
                      autoComplete="url"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder={c.websitePlaceholder}
                      className="field-sm"
                      aria-invalid={websiteErrorFor === "geen" || undefined}
                      aria-describedby={websiteErrorFor === "geen" ? "website-geen-hint website-geen-error" : "website-geen-hint"}
                    />
                    <p id="website-geen-hint" className="mt-1.5 text-[14px] text-muted">
                      {c.websiteHint}
                    </p>
                    {websiteErrorFor === "geen" && (
                      <p id="website-geen-error" className="mt-1.5 text-[14px] text-rood" role="alert">
                        {c.websiteError}
                      </p>
                    )}
                  </div>
                  <TurnstileWidget />
                  <button type="submit" className="btn-sm">
                    {c.unlistedButton}
                  </button>
                </form>
              </section>
            )}
            <p className="mt-6 text-[14px]">
              <Link href={href("/")} className="btn-link">{c.back}</Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="h2">{emailInvalid ? c.email : identityInvalid ? c.identity : allowed || !q ? c.none : c.again}</h1>
            <div className="mt-8">
              <ScanField defaultName={parsed.query} defaultPlace={place ?? ""} emailInvalid={emailInvalid} identityInvalid={identityInvalid} note={false} />
            </div>
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
