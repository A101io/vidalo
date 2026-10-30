import Link from "next/link";
import type { Hours, PriceItem } from "@vidalo/core/types";
import { buildFactsHistory, type FactChange } from "@vidalo/core/facts-history";
import { getI18n } from "@/lib/i18n";
import { requireOwner } from "@/lib/owner";
import { loadFactsHistory } from "@/lib/reads";
import { dateShort, dateTime } from "@/lib/format";
import { Stip } from "@/components/Stip";

export const dynamic = "force-dynamic";

type I18n = Awaited<ReturnType<typeof getI18n>>;

/** One change in plain words: the field's label from the facts form, then what it was and what it is. */
function changeLines(c: FactChange, { copy, lang }: I18n): { label: string; text: string }[] {
  const F = copy.facts.fields;
  const H = copy.factsHistory;
  const or = (v: string | null) => v ?? H.none;
  const wasNow = (a: string | null, b: string | null) => `${H.from} ${or(a)}, ${H.to} ${or(b)}`;
  const addRemove = (added: string[], removed: string[]) => [added.length ? `${H.added}: ${added.join(", ")}` : null, removed.length ? `${H.removed}: ${removed.join(", ")}` : null].filter(Boolean).join("; ");
  switch (c.kind) {
    case "value": {
      const word = (v: string | null): string | null => {
        if (v == null) return null;
        if (c.field === "openStatus") return F.openStatusOptions[v as keyof typeof F.openStatusOptions] ?? v;
        if (c.field === "sector") return copy.sectors[v as keyof typeof copy.sectors] ?? v;
        if (c.field === "urgencyAvailable") return v === "yes" ? F.yes : F.no;
        if (c.field === "serviceAreaRadiusKm") return H.km(v);
        return v;
      };
      return [{ label: F[c.field], text: wasNow(word(c.before), word(c.after)) }];
    }
    case "list":
      return [{ label: F[c.field], text: addRemove(c.added, c.removed) }];
    case "prices": {
      const money = new Intl.NumberFormat(lang === "en" ? "en-GB" : "nl-NL", { style: "currency", currency: "EUR" });
      const p = (x: PriceItem) => `${x.label} ${money.format(x.amount)}${x.unit ? ` ${x.unit}` : ""}`;
      return [{ label: F.prices, text: addRemove(c.added.map(p), c.removed.map(p)) }];
    }
    case "hours": {
      const h = (x: Hours | null) => (!x ? null : x.closed ? H.closed : `${x.open ?? "?"}–${x.close ?? "?"}`);
      return c.days.map((d) => ({ label: `${copy.facts.groups.hours}, ${copy.facts.days[d.day]}`, text: wasNow(h(d.before), h(d.after)) }));
    }
  }
}

/**
 * Every version of the owner's facts, newest first: number, date, confirmed
 * or provisional, what changed against the version before, and the checks
 * that ran while it was current (core/facts-history.ts). Linked from the
 * facts version row on /app/account.
 */
export default async function FactsHistoryPage({ searchParams }: { searchParams: Promise<{ bevestigd?: string }> }) {
  const sp = await searchParams;
  const { business } = await requireOwner("/app/gegevens/versies");
  const { versions, runs } = await loadFactsHistory(business.id);
  const i18n = await getI18n();
  const { copy, href } = i18n;
  const H = copy.factsHistory;
  const A = copy.account;
  const history = buildFactsHistory(versions, runs);

  return (
    <div className="space-y-8">
      <header>
        <Link href={href("/app/account")} className="btn-link">
          {H.back}
        </Link>
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="h2">{H.h1}</h1>
          <Link href={href("/app/gegevens")} className="btn-sm">
            {H.edit}
          </Link>
        </div>
        <p className="mt-2 text-[17px] text-ink-2">{H.intro}</p>
        {sp.bevestigd === "1" && <p className="mt-3 rounded-xl bg-groen-bg px-4 py-3 text-[15px] text-groen-ink">{H.reconfirmedNotice}</p>}
      </header>

      {history.length === 0 ? (
        <p className="text-[15px] text-muted">{H.empty}</p>
      ) : (
        <ol className="space-y-4">
          {history.map((v, i) => {
            const lines = v.changes?.flatMap((c) => changeLines(c, i18n)) ?? [];
            return (
              <li key={v.version} className="card">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b-[1.5px] border-line px-5 py-4">
                  <h2 className="h3">
                    {H.version(v.version)}
                    {i === 0 && <span className="ml-2 text-[14px] font-semibold text-muted">· {H.current}</span>}
                  </h2>
                  <span className="inline-flex items-center gap-2 text-[14px]">
                    <Stip tone={v.provisional ? "grijs" : "groen"} /> {v.confirmedAt ? H.confirmed(dateShort(v.confirmedAt)) : H.provisional(v.since ? dateShort(v.since) : null)}
                  </span>
                </div>
                <div className="space-y-4 px-5 py-4 text-[15px]">
                  {v.provisional && <p className="text-muted">{H.provisionalNote}</p>}
                  {v.changes === null ? (
                    <p>{H.first}</p>
                  ) : lines.length === 0 ? (
                    <p>{v.provisional ? H.unchanged : H.reconfirmed}</p>
                  ) : (
                    <div>
                      <h3 className="text-[14px] font-bold">{H.changesH}</h3>
                      <ul className="mt-2 space-y-1.5">
                        {lines.map((l, k) => (
                          <li key={k} className="grid gap-x-6 sm:grid-cols-[220px_1fr]">
                            <span className="text-muted">{l.label}</span>
                            <span>{l.text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div>
                    <h3 className="text-[14px] font-bold">{H.runsH}</h3>
                    {v.runs.length === 0 ? (
                      <p className="mt-2 text-muted">{H.noRuns}</p>
                    ) : (
                      <ul className="mt-2 space-y-1.5">
                        {v.runs.map((r) => (
                          <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                            <span>
                              {r.status === "done" ? (
                                <Link href={href(`/r/${r.id}`)} className="underline-offset-2 hover:underline">
                                  {A.runKind[r.kind]}
                                </Link>
                              ) : (
                                A.runKind[r.kind]
                              )}{" "}
                              <span className="text-muted">· {dateTime(r.finishedAt ?? r.startedAt)}</span>
                            </span>
                            <span className="inline-flex items-center gap-2 text-[14px]">
                              <Stip tone={r.status === "done" ? "groen" : r.status === "failed" ? "rood" : "oranje"} /> {A.runStatus[r.status]}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
