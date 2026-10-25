import type { Stip as StipColour } from "@vidalo/core/types";
import { getI18n } from "@/lib/i18n";
import { Stip } from "./Stip";

export interface ReportRowData {
  question: string;
  /** What the AI said. */
  said: string;
  /** rood = wrong, grijs = not found / not named, groen = correct. */
  tone: Extract<StipColour, "rood" | "grijs" | "groen">;
  /** The correct value, or "klopt" on a green row. */
  correct: string;
  /** Source of the error (host, label) or "—". */
  source: string;
  sourceUrl?: string | null;
  /** Optional second line under the question (e.g. the instable or recommendation note). */
  note?: string;
}

const saidColour = { rood: "text-rood", grijs: "text-muted", groen: "text-groen" } as const;
const grid = "sm:grid sm:grid-cols-[32px_1.3fr_1.2fr_1fr_1fr] sm:items-center sm:gap-4";

/** Header row of the question table. Hidden on phones, where rows become stacked cards. */
export async function ReportHeaderRow({ compact = false }: { compact?: boolean }) {
  const { copy } = await getI18n();
  const h = copy.result.table.headers;
  return (
    <div className={`hidden border-b-[1.5px] border-ink font-semibold text-muted print:break-after-avoid ${compact ? "py-2.5 text-[12px]" : "py-3 text-[13px]"} ${grid}`}>
      <span />
      <span>{h.question}</span>
      <span>{h.said}</span>
      <span>{h.correct}</span>
      <span>{h.source}</span>
    </div>
  );
}

/** One question of the report: dot, question, what AI said, what is right, where it came from. */
export async function ReportRow({ row, compact = false }: { row: ReportRowData; compact?: boolean }) {
  const { copy } = await getI18n();
  const h = copy.result.table.headers;
  const ok = row.tone === "groen";
  const source = row.sourceUrl ? (
    <a href={row.sourceUrl} target="_blank" rel="nofollow noopener" className="underline-offset-2 hover:underline">
      {row.source}
    </a>
  ) : (
    row.source
  );
  return (
    <div className={`row-hover flex flex-col gap-1.5 border-b-[1.5px] border-line ${compact ? "py-3 text-[14px]" : "py-4 text-[15px]"} ${grid} ${ok ? "text-muted" : ""}`}>
      <span className="hidden sm:block">
        <Stip tone={row.tone} size={10} />
      </span>
      <span className="flex items-center gap-2.5 font-semibold text-ink">
        <Stip tone={row.tone} size={10} className="sm:hidden" />
        <span>
          {row.question}
          {row.note && <span className="block text-[13px] font-normal text-muted">{row.note}</span>}
        </span>
      </span>
      <span className={`font-bold ${saidColour[row.tone]}`}>
        <span className="mr-1.5 text-[12px] font-semibold text-muted sm:hidden">{h.said}:</span>
        {row.said}
      </span>
      <span>
        <span className="mr-1.5 text-[12px] font-semibold text-muted sm:hidden">{h.correct}:</span>
        {row.correct}
      </span>
      <span className={`break-words text-muted ${row.source === copy.result.table.none ? "hidden sm:block" : ""}`}>
        <span className="mr-1.5 text-[12px] font-semibold text-muted sm:hidden">{h.source}:</span>
        {source}
      </span>
    </div>
  );
}
