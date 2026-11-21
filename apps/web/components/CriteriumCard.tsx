import type { Severity } from "@vidalo/core/types";
import { CRITERIA } from "@vidalo/core/criteria";
import { getI18n } from "@/lib/i18n";
import { Stip, type Tone } from "./Stip";

export const severityTone: Record<Severity, Tone> = { afhaker: "rood", misleider: "oranje", verwarring: "grijs" };

/** One of the three criteria cards: afhakers / misleiders / verwarring, rows from `CRITERIA` in core. */
export async function CriteriumCard({ severity, children }: { severity: Severity; children?: React.ReactNode }) {
  const { copy } = await getI18n();
  const C = copy.landing.criteria;
  const group = C.groups[severity];
  const rows = CRITERIA.filter((c) => c.severity === severity);
  return (
    <div className="card flex flex-col gap-3.5 rounded-[20px] p-6">
      <div className="flex items-center gap-2.5">
        <Stip tone={severityTone[severity]} size={14} />
        <span className="text-[19px] font-extrabold">{group.title}</span>
      </div>
      <p className="text-[15px] leading-[1.5] text-ink-2">{group.body}</p>
      <div className="flex flex-col gap-2 text-[14px]">
        {rows.map((c) => (
          <div key={c.id} className="flex justify-between gap-3 border-t-[1.5px] border-panel pt-2">
            <span className="font-semibold">{C.labels[c.id as keyof typeof C.labels]}</span>
            <span className="text-right text-muted">{C.questions[c.id as keyof typeof C.questions]}</span>
          </div>
        ))}
      </div>
      {children}
    </div>
  );
}
