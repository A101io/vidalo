"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { copyFor, type Lang } from "@vidalo/core/copy";
import { ENGINE_LABEL } from "@vidalo/core/types";
import type { scanStatusBody } from "@vidalo/core/scanner";
import { localizeHref } from "@/lib/lang-paths";
import "./waiting.css";

/** The status endpoint's body (BE-07). Everything in it came from outside: render it as React text only. */
export type WaitState = ReturnType<typeof scanStatusBody>;

const STAGES = ["understand", "choose", "ask", "compare"] as const;
const SHOW_QUESTIONS = 8;

type StepState = "done" | "active" | "waiting" | "stopped";

function stepState(i: number, s: WaitState): StepState {
  if (s.status === "failed") {
    const at = STAGES.indexOf(s.stage === "done" ? "compare" : s.stage);
    return i < at ? "done" : i === at ? "stopped" : "waiting";
  }
  const at = s.stage === "done" ? STAGES.length : STAGES.indexOf(s.stage);
  return i < at ? "done" : i === at ? "active" : "waiting";
}

/** The picture of the work: reading, choosing, questions out and answers back, comparing. Decorative; the steps carry the facts. */
function Visual({ s }: { s: WaitState }) {
  const live = s.status === "queued" || s.status === "running";
  const lanes = s.stage === "ask" || s.stage === "compare" || s.stage === "done";
  const barCount = s.stage === "understand" ? 3 : Math.min(Math.max(s.questions.length, 1), 6);
  const widths = [84, 62, 74, 52, 68, 58];
  return (
    <div className={`wv-visual wv-stage ${live ? "wv-live" : ""}`} data-stage={s.stage} aria-hidden="true">
      <div className="wv-core">
        <span className="wv-core-ring" />
        <span className="wv-core-ring" />
        <span className="wv-core-dot">V</span>
      </div>
      {lanes && s.engines.length > 0 ? (
        <div className="wv-lanes">
          {s.engines.map((e, i) => (
            <div key={e.engine} className={`wv-lane ${s.stage === "ask" && e.expected > 0 && e.received >= e.expected ? "wv-lane--rest" : ""}`} style={{ ["--i" as string]: i }}>
              <span className="wv-track">
                <i className="wv-q" />
                <i className="wv-a" />
              </span>
              <span className="wv-eng">{ENGINE_LABEL[e.engine] ?? e.engine}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="wv-bars">
          {Array.from({ length: barCount }, (_, i) => (
            <span key={`${s.stage}-${i}`} className={`wv-bar ${s.stage === "understand" ? "" : "wv-bar--q"}`} style={{ ["--i" as string]: i, ["--w" as string]: `${widths[i % widths.length]}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ScanProgress({ token, businessName, initial, lang }: { token: string; businessName: string; initial: WaitState; lang: Lang }) {
  const copy = copyFor(lang);
  const c = copy.scan;
  const [s, setS] = useState<WaitState>(initial);
  /** The stage in which the reading of the business first appeared: the screen reader hears it then, once. */
  const [readingAt, setReadingAt] = useState<WaitState["stage"] | null>(initial.profile ? initial.stage : null);
  const router = useRouter();

  useEffect(() => {
    if (s.status === "done" || s.status === "failed") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/scan/${encodeURIComponent(token)}/status`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as WaitState;
        if (cancelled) return;
        setS(data);
        setReadingAt((at) => at ?? (data.profile ? data.stage : null));
        if (data.status === "done" && data.reportUrl) router.replace(localizeHref(data.reportUrl, lang));
      } catch {
        /* retry on next tick */
      }
    };
    void tick();
    const t = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token, s.status, router, lang]);

  const engineNames = s.engines.map((e) => ENGINE_LABEL[e.engine] ?? e.engine);
  const labels = [c.stages.understand, c.stages.choose, c.stages.ask(engineNames), c.stages.compare];
  const reading = s.profile ? c.profileSentence(s.profile, businessName) : null;
  const liveSentence = s.status === "failed" ? c.failed : c.live[s.stage];
  const shown = s.questions.slice(0, SHOW_QUESTIONS);
  const hidden = s.questions.length - shown.length;
  const atAsk = STAGES.indexOf(s.stage === "done" ? "compare" : s.stage) <= 2;

  return (
    <div className="mt-8">
      <p className="sr-only" aria-live="polite">{liveSentence}{reading && readingAt === s.stage ? ` ${reading}` : ""}</p>
      <Visual s={s} />
      <ol className={`card mt-5 wv-steps ${s.status === "queued" || s.status === "running" ? "wv-live" : ""}`}>
        {labels.map((label, i) => {
          const st = stepState(i, s);
          return (
            <li key={STAGES[i]} className="wv-step" data-state={st} aria-current={st === "active" ? "step" : undefined}>
              <span aria-hidden="true" className="wv-dot" />
              <div className="wv-body">
                <div className="wv-head">
                  <p className="wv-label">{label}</p>
                  <span className="wv-state">{c.state[st]}</span>
                </div>
                {i === 0 && reading ? <p className="wv-detail wv-rise">{reading}</p> : null}
                {i === 1 && shown.length > 0 ? (
                  <ul className="wv-qs">
                    {shown.map((q, n) => (
                      <li key={q.id} className="wv-rise" style={{ animationDelay: `${n * 90}ms` }}>{q.text}</li>
                    ))}
                    {hidden > 0 ? <li className="wv-more wv-rise">{c.moreQuestions(hidden)}</li> : null}
                  </ul>
                ) : null}
                {i === 2 && s.engines.length > 0 ? (
                  <ul className="wv-engs">
                    {s.engines.map((e) => (
                      <li key={e.engine} data-state={s.status === "failed" ? "waiting" : atAsk ? "active" : "done"} className="wv-rise">
                        <span aria-hidden="true" className="wv-dot" />
                        <span>{ENGINE_LABEL[e.engine] ?? e.engine}</span>
                        <span className="wv-n">{c.answers(e.received)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {s.status === "failed" ? (
        <p className="mt-4 text-[15px]">
          {c.failed}{" "}
          <Link href={localizeHref("/#top", lang)} className="btn-link">{c.retry}</Link>
        </p>
      ) : s.status === "done" ? (
        <p className="mt-4 text-[15px]">
          <Link href={localizeHref(s.reportUrl ?? `/scan/${token}`, lang)} className="btn-link">{c.toReport}</Link>
        </p>
      ) : (
        <p className="mt-4 text-[14px] text-muted">{c.waiting}</p>
      )}
    </div>
  );
}
