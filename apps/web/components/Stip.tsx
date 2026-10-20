import type { Stip as StipColour } from "@vidalo/core/types";

export type Tone = StipColour | "blue" | "ink";

export const stipBg: Record<Tone, string> = {
  rood: "bg-rood",
  oranje: "bg-oranje",
  groen: "bg-groen",
  grijs: "bg-grijs",
  blue: "bg-blue",
  ink: "bg-ink",
};

/** Text on a filled status circle: white where it reads (4.5:1), ink on the light orange and grey so they keep their colour. */
export const stipText: Record<Tone, string> = {
  rood: "text-white",
  oranje: "text-ink",
  groen: "text-white",
  grijs: "text-ink",
  blue: "text-white",
  ink: "text-white",
};

/** The status dot: 10px inline, 12/14px in lists, 22px in plan steps. Grey is its own state, never "no errors". */
export function Stip({ tone, size = 10, className = "" }: { tone: Tone; size?: 10 | 12 | 14 | 22; className?: string }) {
  const px = { 10: "h-2.5 w-2.5", 12: "h-3 w-3", 14: "h-3.5 w-3.5", 22: "h-[22px] w-[22px]" }[size];
  return <span aria-hidden className={`inline-block shrink-0 rounded-full ${px} ${stipBg[tone]} ${className}`} />;
}

/** The hero circle on result pages (220px) and the sample report (180px): number + two-line label inside. */
export function StipHero({ tone, number, label, size = 220 }: { tone: StipColour; number: string | number; label: readonly string[] | string[]; size?: 180 | 220 }) {
  const dim = size === 220 ? "h-[180px] w-[180px] sm:h-[220px] sm:w-[220px]" : "h-[150px] w-[150px] sm:h-[180px] sm:w-[180px]";
  const num = size === 220 ? "text-[46px] sm:text-[56px]" : "text-[40px] sm:text-[46px]";
  // A whole number counts up from 0 on load (CSS only, see globals.css); the
  // real number is the text underneath, so it is what screen readers get.
  const to = typeof number === "number" ? number : /^\d+$/.test(number.trim()) ? Number(number) : null;
  return (
    <div className={`stip-hero flex shrink-0 flex-col items-center justify-center rounded-full text-center ${stipText[tone]} ${dim} ${stipBg[tone]}`}>
      <div
        className={`font-extrabold leading-none ${num} ${to ? "stip-num" : ""}`}
        style={{ letterSpacing: "-2px", ...(to ? ({ "--to": to } as React.CSSProperties) : {}) }}
      >
        {to ? <span className="stip-num-text">{number}</span> : number}
      </div>
      <div className="mt-1 text-[13px] font-semibold sm:text-[15px]">
        {label.map((l, i) => (
          <span key={i} className="block">
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One row of a short timeline: dot, text, meta on the right. Green rows get the tinted background. */
export function StipRow({ tone, text, meta, strong = false }: { tone: StipColour; text: string; meta?: string; strong?: boolean }) {
  const green = tone === "groen";
  return (
    <div className={`flex items-center gap-3.5 rounded-[14px] px-4 py-3.5 ${green ? "bg-groen-bg" : "bg-panel"}`}>
      <span data-stip className="flex">
        <Stip tone={tone} size={12} />
      </span>
      <span className={`flex-1 text-[15px] ${strong || green ? "font-bold" : ""}`}>{text}</span>
      {meta && <span className={`shrink-0 text-[13px] ${green ? "text-groen-ink" : "text-muted"}`}>{meta}</span>}
    </div>
  );
}
