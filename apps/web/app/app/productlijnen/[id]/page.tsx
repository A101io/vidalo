import Link from "next/link";
import { notFound } from "next/navigation";
import { ENGINE_LABEL, type Finding } from "@vidalo/core/types";
import { changeOver, criteriumGrid, engineGrid, filterCells, inPeriod, snapshotStip, tally, type ProgressFilter } from "@vidalo/core/progress";
import { LINE_MARKETS, PRODUCT_LINE_LIMITS, countryName, productLineAccess, type ProductLineFieldError } from "@vidalo/core/shared";
import { getI18n } from "@/lib/i18n";
import { requireOwner } from "@/lib/owner";
import { ready } from "@/lib/core";
import { dateShort, dayMonth, hostOf } from "@/lib/format";
import { correctText, wrongText } from "@/lib/questions";
import { fixPlan } from "@/lib/owner-data";
import { Dot, LogRow, QuietLink, Row, Section, SmallButton } from "@/components/OwnerUi";
import { Stip } from "@/components/Stip";
import { DotGrid } from "@/components/DotGrid";
import { fieldErrorText, linesReadable, loadProductLineDetail, parseFout, pickMarket, safeHttpUrl } from "@/lib/product-lines";
import { toFormInput } from "@/lib/line-form-input";
import { LineForm } from "../LineForm";
import { setProductLineStatus } from "../actions";

export const dynamic = "force-dynamic";

type Search = { markt?: string; bewerken?: string; betwist?: string; opgeslagen?: string; status?: string; fout?: string };

const ALL: ProgressFilter = { engine: "all", bundle: "all" };
const GRID_COLUMNS = 12;

export default async function ProductLinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { business, session } = await requireOwner(`/app/productlijnen/${id}`);
  if (!linesReadable()) notFound();
  const { copy, lang, href } = await getI18n();
  const P = copy.productLines;
  const D = P.detail;
  const db = await ready();
  const detail = await loadProductLineDetail(id, business, db);
  if (!detail) notFound();
  const { line, versions } = detail;
  const v = line.current;
  const access = productLineAccess(business, session.userId);
  const market = pickMarket(line, sp.markt);
  const m = detail.markets.find((x) => x.market === market)!;
  const marketName = (code: string) => countryName(code, lang);
  const stipWord = copy.ownerArea.archive.stip;
  const editing = sp.bewerken === "1" && access.ok;
  // ?betwist= only switches a fixed sentence on, and only for a finding of this business and this line.
  const disputed = Boolean(sp.betwist) && (await db.getFinding(sp.betwist!).catch(() => null))?.productLineId === line.id;

  const fout = parseFout(sp.fout);
  const urlField: ProductLineFieldError | null = fout?.kind === "field" ? { field: fout.field, ...(fout.index !== undefined ? { index: fout.index } : {}), reason: fout.reason } : null;
  const urlFieldOk = urlField && fieldErrorText(P.errors as never, urlField.field, urlField.reason) ? urlField : null;
  const message = sp.opgeslagen ? P.saved : sp.status ? P.statusSaved : fout?.kind === "limit" ? P.limitError(PRODUCT_LINE_LIMITS.lines) : fout?.kind === "access" && access.ok ? P.access[fout.reason] : null;

  const snaps = inPeriod(m.snapshots, "all");
  const gridSnaps = snaps.slice(-GRID_COLUMNS);
  const gridDates = gridSnaps.map((s) => dayMonth(s.checkedAt));
  const factRows = criteriumGrid(gridSnaps, ALL).map((r) => ({ label: copy.criteria[r.criterium], cells: r.cells }));
  const engineRows = engineGrid(gridSnaps, "all").map((r) => ({ label: ENGINE_LABEL[r.engine], cells: r.cells }));
  const latestSnap = snaps[snaps.length - 1] ?? null;
  const change = changeOver(snaps, ALL);
  const now = latestSnap ? tally(filterCells(latestSnap.cells, ALL)) : null;
  const dot = latestSnap ? snapshotStip(latestSnap, ALL) : null;
  const progress = copy.progress;
  const changeLine = (key: "correct" | "wrong" | "notFound") => (change ? progress.change(change[key], dayMonth(change.base.checkedAt)) : progress.noChange);

  /** The finding's subject as the owner reads it: a market code becomes the country. */
  const subjectOf = (f: Finding) => (f.factKey === "outlet" && f.subject ? marketName(f.subject) : f.subject);
  const labelOf = (f: Finding) => `${copy.factKey[f.factKey]}${subjectOf(f) ? `: ${subjectOf(f)}` : ""}`;

  return (
    <div className="flex flex-col gap-12">
      <QuietLink href={href("/app/productlijnen")}>← {P.back}</QuietLink>

      <header className="flex max-w-[760px] flex-col gap-3">
        <p className="m-0 text-[14px] text-muted">
          {v.category}
          {line.status === "discontinued" ? <span className="pill ml-3">{P.discontinued}</span> : <span className="pill ml-3">{P.active}</span>}
        </p>
        <h1 className="h1-sm">{v.name}</h1>
        <p className="m-0 text-[15px] text-ink-2">
          {D.version(v.version, dateShort(v.confirmedAt))} · {D.versions(versions)}
        </p>
        <div role="status" aria-live="polite" className={message ? "rounded-xl bg-panel px-5 py-4 text-[15px]" : "sr-only"}>
          {message}
        </div>
        {!access.ok && <p className="m-0 rounded-xl border-[1.5px] border-line px-5 py-4 text-[15px]">{P.access[access.reason]}</p>}
        {access.ok && !editing && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-2">
            <SmallButton href={href(`/app/productlijnen/${line.id}?bewerken=1`)}>{D.edit}</SmallButton>
          </div>
        )}
      </header>

      {editing && (
        <LineForm
          lang={lang}
          businessId={business.id}
          lineId={line.id}
          initial={toFormInput(v)}
          marketOptions={LINE_MARKETS.map((code) => ({ code, name: countryName(code, lang) }))}
          cancelHref={href(`/app/productlijnen/${line.id}`)}
          disputed={disputed}
          urlError={urlFieldOk}
          title={P.form.editTitle(v.name)}
        />
      )}

      {line.current.markets.length > 1 && (
        <nav aria-label={D.marketsLabel} className="flex flex-wrap gap-2">
          {line.current.markets.map((code) => (
            <Link
              key={code}
              href={href(`/app/productlijnen/${line.id}?markt=${code}`)}
              scroll={false}
              aria-current={code === market ? "true" : undefined}
              className={`inline-flex h-11 items-center rounded-pill border-[1.5px] px-4 text-[15px] font-semibold transition-colors ${code === market ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-2 hover:border-ink"}`}
            >
              {marketName(code)}
            </Link>
          ))}
        </nav>
      )}

      {/* Latest check */}
      <Section title={`${D.lastTitle}: ${marketName(market)}`} aside={m.latest ? D.lastOn(dateShort(m.latest.createdAt)) : undefined}>
        {m.latest?.summary ? (
          <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-[17px]">
            {m.latest.summary.snapshot.engineStips.map((e) => (
              <li key={e.engine}>
                <Dot tone={e.stip} />
                {ENGINE_LABEL[e.engine]} <span className="text-[15px] text-muted">{stipWord[e.stip]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 max-w-[640px] text-[17px] text-ink-2">{D.notChecked}</p>
        )}
      </Section>

      {/* Errors */}
      <Section title={D.errorsTitle}>
        {m.open.length === 0 ? (
          <p className="m-0 text-[17px] text-ink-2">{m.latest ? D.noErrors : D.notChecked}</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {m.open.map((g, i) => {
              const f = g.lead;
              const plan = fixPlan(f, m.fixes.get(f.id) ?? null);
              const host = f.sourceUrl ? hostOf(f.sourceUrl) : null;
              const outlet = f.factKey === "outlet";
              return (
                <Row
                  key={g.key}
                  last={i === m.open.length - 1}
                  right={
                    <SmallButton href={href(`/app/fouten/${f.id}`)}>
                      {D.open}
                      <span className="sr-only"> {labelOf(f)}</span>
                    </SmallButton>
                  }
                >
                  <p className="m-0 font-bold">{labelOf(f)}</p>
                  <p className="m-0 mt-1 text-[16px]">
                    <Dot tone={f.status === "open" ? "rood" : "oranje"} />
                    {outlet ? D.outletNotListed(wrongText(f, copy)) : D.says(wrongText(f, copy), correctText(f, copy))}
                  </p>
                  {outlet && <p className="m-0 mt-1 text-[14px] text-muted">{D.outletNote}</p>}
                  <p className="m-0 mt-1 text-[14px] text-ink-2">{g.findings.map((x) => D.times(ENGINE_LABEL[x.engine], x.frequency, x.sampleCount)).join(" · ")}</p>
                  <p className="m-0 mt-1 text-[14px] text-muted">{host ? D.source(host) : D.sourceNone}</p>
                  <p className="m-0 mt-1 text-[14px] text-ink-2">
                    <span className="font-semibold">{D.whatWeDo}:</span> {plan.labelNl}
                    {plan.recheckAt ? ` ${dateShort(plan.recheckAt)}` : ""}
                  </p>
                </Row>
              );
            })}
          </ul>
        )}
        {m.resolved.length > 0 && (
          <div className="flex flex-col gap-3">
            <h3 className="m-0 text-[17px] font-bold">{D.resolvedTitle}</h3>
            <ol className="m-0 list-none p-0">
              {m.resolved.map((f, i) => (
                <LogRow
                  key={f.id}
                  date={f.resolvedAt ? dayMonth(f.resolvedAt) : ""}
                  last={i === m.resolved.length - 1}
                  proof={
                    <QuietLink href={href(`/app/fouten/${f.id}`)}>
                      {D.open}
                      <span className="sr-only"> {labelOf(f)}</span>
                    </QuietLink>
                  }
                >
                  <Dot tone="groen" />
                  {D.resolvedLine(f.resolvedAt ? dateShort(f.resolvedAt) : "", `${labelOf(f)}: ${wrongText(f, copy)} → ${correctText(f, copy)}`, ENGINE_LABEL[f.engine])}
                </LogRow>
              ))}
            </ol>
          </div>
        )}
      </Section>

      {/* Who AI does name */}
      <Section title={D.namedTitle}>
        {m.recommend ? (
          <>
            <p className="m-0 text-[17px] font-semibold">{D.namedSummary(m.recommend.named, m.recommend.answers)}</p>
            {m.recommend.others.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className="m-0 text-[15px] font-bold">{D.others}</h3>
                <ul className="m-0 list-none p-0 text-[16px]">
                  {[...m.recommend.others]
                    .sort((a, b) => a.name.localeCompare(b.name, lang))
                    .map((o) => (
                      <li key={o.name} className="border-t-[1px] border-line py-2">
                        {D.otherLine(o.name, o.answers, m.recommend!.answers)}
                      </li>
                    ))}
                </ul>
              </div>
            ) : (
              <p className="m-0 text-[15px] text-muted">{D.noOthers}</p>
            )}
            <p className="m-0 max-w-[640px] text-[14px] text-muted">{D.namedNote}</p>
          </>
        ) : (
          <p className="m-0 max-w-[640px] text-[15px] text-muted">{m.latest ? D.namedNone : D.notChecked}</p>
        )}
      </Section>

      {/* Progress */}
      <Section title={D.trendTitle} aside={dot ? <span className="inline-flex items-center"><Stip tone={dot} size={12} className="mr-2" />{stipWord[dot]}</span> : undefined}>
        {!now || !latestSnap ? (
          <p className="m-0 text-[15px] text-muted">{D.notChecked}</p>
        ) : (
          <>
            <dl className="m-0 grid gap-x-8 gap-y-4 sm:grid-cols-3">
              {(
                [
                  ["correct", progress.indicators.correct, progress.of(now.correct, now.total)],
                  ["wrong", progress.indicators.wrong, String(now.wrong)],
                  ["notFound", progress.indicators.notFound, String(now.notFound)],
                ] as const
              ).map(([key, label, value]) => (
                <div key={key} className="flex flex-col gap-1 border-t-[1px] border-line pt-3">
                  <dt className="text-[14px] font-semibold text-muted">{label}</dt>
                  <dd className="m-0 text-[24px] font-extrabold leading-tight">{value}</dd>
                  <dd className="m-0 text-[13px] text-muted">{changeLine(key)}</dd>
                </div>
              ))}
            </dl>
            {snaps.length === 1 && <p className="m-0 text-[15px] text-muted">{D.trendOne}</p>}
            {factRows.length > 0 && (
              <div>
                <h3 className="m-0 text-[17px] font-bold">{D.factsTitle}</h3>
                <DotGrid rows={factRows} dates={gridDates} notAsked={progress.notAsked} missesTitle={progress.misses} words={stipWord} label={D.factsTitle} />
              </div>
            )}
            {engineRows.length > 0 && (
              <div>
                <h3 className="m-0 text-[17px] font-bold">{D.enginesTitle}</h3>
                <DotGrid rows={engineRows} dates={gridDates} notAsked={progress.notAsked} missesTitle={progress.misses} words={stipWord} label={D.enginesTitle} />
              </div>
            )}
            <p className="m-0 text-[13px] text-muted">{progress.legend}</p>
          </>
        )}
      </Section>

      {/* What we check */}
      <Section title={D.dataTitle}>
        <dl className="m-0 grid gap-x-8 gap-y-4 sm:grid-cols-[200px_minmax(0,1fr)]">
          <dt className="text-[14px] font-bold">{D.dataCategory}</dt>
          <dd className="m-0 text-[16px]">{v.category}</dd>
          <dt className="text-[14px] font-bold">{D.dataUses}</dt>
          <dd className="m-0 text-[16px]">{v.useCases.length ? v.useCases.join(", ") : D.dataNone}</dd>
          <dt className="text-[14px] font-bold">{D.dataSpecs}</dt>
          <dd className="m-0 text-[16px]">
            {v.specs.length ? (
              <ul className="m-0 list-none p-0">
                {v.specs.map((s, i) => (
                  <li key={i}>
                    {s.label}: {s.value}
                  </li>
                ))}
              </ul>
            ) : (
              D.dataNone
            )}
          </dd>
          <dt className="text-[14px] font-bold">{D.dataCerts}</dt>
          <dd className="m-0 text-[16px]">
            {v.certificates.length ? (
              <ul className="m-0 list-none p-0">
                {v.certificates.map((c, i) => (
                  <li key={i}>{D.certLine(c.name, c.number, c.validUntil)}</li>
                ))}
              </ul>
            ) : (
              D.dataNone
            )}
          </dd>
          <dt className="text-[14px] font-bold">{D.dataOutlets}</dt>
          <dd className="m-0 text-[16px]">
            {v.outlets.length ? (
              <ul className="m-0 list-none p-0">
                {v.outlets.map((o, i) => {
                  const url = safeHttpUrl(o.url);
                  return (
                    <li key={i}>
                      {marketName(o.market)}: {o.name}
                      {url && (
                        <>
                          {" "}
                          <a href={url} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-[14px] text-muted underline underline-offset-[3px] hover:text-blue">
                            {hostOf(url)}
                            <span className="sr-only">. {D.openOutlet} {o.name}</span>
                          </a>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              D.dataNone
            )}
          </dd>
          <dt className="text-[14px] font-bold">{D.dataReplaces}</dt>
          <dd className="m-0 text-[16px]">{v.replaces.length ? v.replaces.join(", ") : D.dataNone}</dd>
          <dt className="text-[14px] font-bold">{D.dataReplacedBy}</dt>
          <dd className="m-0 text-[16px]">{v.replacedBy ?? D.dataNone}</dd>
        </dl>
      </Section>

      {/* Status */}
      {access.ok && (
        <Section title={D.statusTitle}>
          <form action={setProductLineStatus} className="m-0 flex flex-col items-start gap-3">
            <input type="hidden" name="business" value={business.id} />
            <input type="hidden" name="line" value={line.id} />
            <input type="hidden" name="status" value={line.status === "active" ? "discontinued" : "active"} />
            <SmallButton type="submit">{line.status === "active" ? D.discontinueButton : D.activateButton}</SmallButton>
            <p className="m-0 max-w-[640px] text-[14px] text-muted">{line.status === "active" ? D.statusNote : D.statusNoteActive}</p>
          </form>
        </Section>
      )}
    </div>
  );
}
