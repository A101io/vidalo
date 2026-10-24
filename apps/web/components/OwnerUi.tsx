/**
 * The owner area's idiom (docs/design-g/AppG.dc.html, FindingG, ChannelG):
 * whitespace and one ink rule between sections, hanging dates in lists,
 * status colours only in dots and marked spans, one card per page at most.
 */
import Link from "next/link";
import { Stip, type Tone } from "./Stip";

/** A section: ink rule, 24px title, then the content. */
export function Section({ title, aside, children }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <hr className="m-0 border-0 border-t-[1.5px] border-ink" />
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[24px] font-extrabold leading-[1.2]" style={{ letterSpacing: "-0.5px" }}>
          {title}
        </h2>
        {aside && <span className="text-[14px] text-muted">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** A list row: a hairline above, the content, an optional link column on the right. */
export function Row({ children, right, last = false }: { children: React.ReactNode; right?: React.ReactNode; last?: boolean }) {
  return (
    <li className={`flex flex-col justify-between gap-2 border-t-[1px] border-line py-4 sm:flex-row sm:gap-6 ${last ? "border-b-[1px]" : ""}`}>
      <div className="min-w-0 flex-1 text-[17px]">{children}</div>
      {right && <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1">{right}</div>}
    </li>
  );
}

/** A log row: the date hangs left, the text and its proof link on the right. */
export function LogRow({ date, children, proof, last = false }: { date: string; children: React.ReactNode; proof?: React.ReactNode; last?: boolean }) {
  return (
    <li className={`grid gap-x-6 gap-y-1 border-t-[1px] border-line py-4 sm:grid-cols-[88px_minmax(0,1fr)] ${last ? "border-b-[1px]" : ""}`}>
      <span className="text-[14px] font-semibold">{date}</span>
      <div className="flex flex-col gap-1">
        <p className="m-0 text-[17px]">{children}</p>
        {proof && <p className="m-0 flex flex-wrap gap-x-4 text-[14px]">{proof}</p>}
      </div>
    </li>
  );
}

/** Inline dot before a line of text. */
export function Dot({ tone }: { tone: Tone }) {
  return <Stip tone={tone} size={12} className="mr-3 align-[-1px]" />;
}

/** A hollow dot: a step that has not happened yet. */
export function Ring() {
  return <span aria-hidden className="mr-3 inline-block h-3 w-3 shrink-0 rounded-full border-[1.5px] border-grijs bg-white align-[-1px]" />;
}

/** The blue text link. */
export function BlueLink({ href, children, external = false }: { href: string; children: React.ReactNode; external?: boolean }) {
  const cls = "text-[15px] font-bold text-blue hover:underline";
  return external ? (
    <a href={href} target="_blank" rel="noopener" className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

/** The quiet underlined link: proof, secondary places. */
export function QuietLink({ href, children, external = false }: { href: string; children: React.ReactNode; external?: boolean }) {
  const cls = "text-[14px] text-muted underline underline-offset-[3px] hover:text-blue";
  return external ? (
    <a href={href} target="_blank" rel="noopener" className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

/** The small outlined button, as a link or a submit. */
export function SmallButton({ href, children, external = false, type }: { href?: string; children: React.ReactNode; external?: boolean; type?: "submit" }) {
  const cls = "inline-flex h-11 items-center justify-center whitespace-normal rounded-btn border-[1.5px] border-ink bg-white px-4 text-[14px] font-bold text-ink hover:border-blue hover:text-blue";
  if (type === "submit") {
    return (
      <button type="submit" className={cls}>
        {children}
      </button>
    );
  }
  return external ? (
    <a href={href} target="_blank" rel="noopener" className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href ?? "#"} className={cls}>
      {children}
    </Link>
  );
}

/** The rail's label line. */
export function RailLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[14px] font-bold">{children}</span>;
}

/** A wrong value in the report's red tint; the right one in green. */
export function MarkWrong({ children }: { children: React.ReactNode }) {
  return <span className="mark-wrong">{children}</span>;
}
export function MarkOk({ children }: { children: React.ReactNode }) {
  return <span className="rounded-[4px] bg-groen-bg px-1.5 py-0.5">{children}</span>;
}
export function MarkGrey({ children }: { children: React.ReactNode }) {
  return <span className="mark-grey">{children}</span>;
}
