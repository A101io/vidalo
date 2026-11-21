import type { GridCell } from "@vidalo/core/progress";
import type { Stip as StipColour } from "@vidalo/core/types";
import { Stip } from "./Stip";

/**
 * Dots per row and check, as on /app/voortgang, plus the colour in words for a reader who does not see colour:
 * every cell carries its status as text (WCAG 1.4.1), the number under the dot is how many answers were not right.
 */
export function DotGrid({
  rows,
  dates,
  notAsked,
  missesTitle,
  words,
  label,
}: {
  rows: { label: string; cells: GridCell[] }[];
  dates: string[];
  notAsked: string;
  missesTitle: (n: number) => string;
  words: Record<StipColour, string>;
  /** names the scrolling region for a screen reader */
  label: string;
}) {
  return (
    <div className="card relative mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label={label}>
      <table className="w-full min-w-[480px] border-collapse text-[14px]">
        <thead>
          <tr className="border-b-[1.5px] border-line text-[12px] text-muted">
            <th className="sticky left-0 bg-white px-5 py-3 text-left font-semibold" />
            {dates.map((d, i) => (
              <th key={i} scope="col" className="whitespace-nowrap px-2 py-3 text-center font-semibold">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b-[1px] border-line last:border-0">
              <th scope="row" className="sticky left-0 whitespace-nowrap bg-white px-5 py-3 text-left font-semibold">
                {r.label}
              </th>
              {r.cells.map((c, i) => (
                <td key={i} className="px-2 py-2.5 text-center align-top">
                  {c.stip ? (
                    <span className="inline-flex flex-col items-center gap-1" title={missesTitle(c.misses)}>
                      <Stip tone={c.stip} size={12} />
                      <span className="sr-only">{words[c.stip]}. </span>
                      <span className="text-[11px] leading-none text-muted">{c.misses > 0 ? c.misses : " "}</span>
                      <span className="sr-only">{missesTitle(c.misses)}</span>
                    </span>
                  ) : (
                    <span className="text-muted" title={notAsked}>
                      ·<span className="sr-only"> {notAsked}</span>
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
