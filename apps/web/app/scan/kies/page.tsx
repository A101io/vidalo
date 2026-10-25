import Link from "next/link";
import { getI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ScanField } from "@/components/ScanField";
import { resolveBusiness, parseQuery } from "@/lib/core";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { kiesAllowed } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

export default async function ChoosePage({ searchParams }: { searchParams: Promise<{ q?: string; place?: string; plaats?: string; k?: string }> }) {
  const { q = "", place: placeParam, plaats, k } = await searchParams;
  const parsed = parseQuery(q);
  const place = placeParam || parsed.place;
  // A lookup costs money: only after a passed check (the token from POST /api/scan), else the field to start again.
  const allowed = Boolean(q) && kiesAllowed(q, placeParam ?? "", k);
  const candidates = allowed ? await resolveBusiness(parsed.query, place) : [];
  const needsPlace = plaats === "1" || (candidates.length > 0 && candidates.every((c) => !c.place) && !place);
  const { copy, href } = await getI18n();
  const c = copy.scan.choose;
  return (
    <>
      <SiteHeader variant="minimal" />
      <main className="wrap max-w-[760px] py-12 sm:py-16">
        {candidates.length > 0 ? (
          <>
            <h1 className="h2">{needsPlace ? c.placeHint : c.title}</h1>
            {!needsPlace && <p className="lead mt-3">{c.body}</p>}
            <ul className="mt-8 divide-y-[1.5px] divide-line border-y-[1.5px] border-line">
              {candidates.map((cand, i) => (
                <li key={i} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold">
                      {cand.name}
                      {cand.place ? `, ${cand.place}` : ""}
                    </p>
                    <p className="text-[14px] text-muted">{[cand.address, cand.website?.replace(/^https?:\/\/(www\.)?/, ""), cand.kvk ? `KvK ${cand.kvk}` : null].filter(Boolean).join(" · ")}</p>
                  </div>
                  <form action="/api/scan" method="post" className="flex items-end gap-2">
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
                    <TurnstileWidget />
                    <button type="submit" className="btn-sm">
                      {c.button}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[14px]">
              <Link href={href("/")} className="btn-link">{c.back}</Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="h2">{allowed || !q ? c.none : c.again}</h1>
            <div className="mt-8">
              <ScanField defaultName={parsed.query} defaultPlace={place ?? ""} note={false} />
            </div>
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
