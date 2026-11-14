import Link from "next/link";
import type { ScanKind, Stip as StipColour } from "@vidalo/core/types";
import type { CopyShape } from "@vidalo/core/copy";
import { listReportArchive, type ArchiveRow } from "@vidalo/core/db";
import { getI18n } from "@/lib/i18n";
import { requireOwner } from "@/lib/owner";
import { ready } from "@/lib/core";
import { Stip } from "@/components/Stip";
import { CheckNotice } from "@/components/CheckNotice";

export const dynamic = "force-dynamic";

/** Rows per page of the archive (scale budget of AC-7; core caps it at 100 anyway). */
const PAGE = 24;

type Search = { voor?: string; controle?: string };

function date(iso: string, lang: string): string {
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }).format(new Date(iso));
}

export default async function RapportenPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { business } = await requireOwner("/app/rapporten");
  const { copy, href, lang } = await getI18n();
  const A = copy.ownerArea.archive;
  // The query is bound to the active business in SQL; `voor` is a position only and is parsed strictly (a bad one is the first page).
  const { rows, next } = await listReportArchive(await ready(), business.id, { limit: PAGE, before: typeof sp.voor === "string" ? sp.voor : undefined });
  const kindWord = (k: ScanKind) => (k === "recheck" ? copy.progress.scanKind.recheck : A.kind[k]);

  // The newest finished check is what the overview stands on; it cannot be removed (core/db/remove-check.ts).
  const newestDone = rows.find((r) => r.status === "done")?.id;
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-[28px] font-extrabold sm:text-[34px]" style={{ letterSpacing: "-0.5px" }}>
          {A.h1}
        </h1>
        <p className="max-w-[40rem] text-[16px] text-ink-2">{A.intro}</p>
        <CheckNotice code={sp.controle} copy={copy.checks} />
        <p>
          <Link href={href("/controle")} className="btn-sm">
            {copy.checks.newNav}
          </Link>
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="card-sm p-6 text-[16px] text-ink-2">{A.empty}</p>
      ) : (
        <ol className="flex flex-col">
          {rows.map((r) => (
            <Row key={r.id} r={r} lang={lang} kind={kindWord(r.kind)} A={A} openHref={href(`/r/${r.id}`)} removeHref={r.id !== newestDone && (r.status === "done" || r.status === "failed") ? href(`/controle/verwijderen/${r.id}?terug=/app/rapporten`) : null} removeLabel={copy.checks.remove} />
          ))}
        </ol>
      )}

      {next && (
        <p>
          <Link href={href(`/app/rapporten?voor=${encodeURIComponent(next)}`)} className="btn-link">
            {A.older}
          </Link>
        </p>
      )}
    </div>
  );
}

function Row({ r, lang, kind, A, openHref, removeHref, removeLabel }: { r: ArchiveRow; lang: string; kind: string; A: CopyShape["ownerArea"]["archive"]; openHref: string; removeHref: string | null; removeLabel: string }) {
  const done = r.status === "done";
  const tone: StipColour | null = done && r.summary ? r.summary.stip : null;
  // The date is when the check finished, from the summary's snapshot; else when it was queued.
  const when = date(done && r.summary ? r.summary.snapshot.checkedAt : r.createdAt, lang);
  const detail = !done
    ? A.state[r.status === "failed" ? "failed" : r.status === "running" ? "running" : "queued"]
    : r.summary
      ? `${A.stip[r.summary.stip]} · ${A.counts(r.summary.correct, r.summary.answered)}`
      : A.noCounts;
  const inner = (
    <>
      <span className="flex items-center gap-3">
        {tone ? <Stip tone={tone} size={14} /> : <span aria-hidden className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-line" />}
        <span className="text-[17px] font-bold">{when}</span>
        <span className="text-[15px] text-ink-2">{kind}</span>
      </span>
      <span className="text-[15px] text-ink-2 sm:text-right">{detail}</span>
    </>
  );
  return (
    <li className="flex items-center gap-4 border-t-[1px] border-line first:border-t-0">
      {done ? (
        <Link href={openHref} className="flex min-h-11 min-w-0 flex-1 flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          {inner}
        </Link>
      ) : (
        <div className="flex min-h-11 min-w-0 flex-1 flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">{inner}</div>
      )}
      {removeHref && (
        <Link href={removeHref} className="btn-link shrink-0 text-[14px]" aria-label={`${removeLabel}: ${when}`}>
          {removeLabel}
        </Link>
      )}
    </li>
  );
}
