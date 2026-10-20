import { getI18n } from "@/lib/i18n";

/**
 * The landing hero's visual: what Vidalo does, as one loop (12s).
 *
 *   1. A customer asks a question.
 *   2. Four sources feed the AI's answer (particles along the lines).
 *   3. The answer comes back wrong, in red: one source is from 2022.
 *   4. Vidalo finds that source and draws a line to it; the source turns
 *      green, its particles turn green, the answer flips to the right one.
 *
 * No script: the particles and line colours are SVG (SMIL), the rest is CSS
 * keyframes (globals.css, "Hero visual"), so it runs on the static copy too.
 * Under reduced motion it shows the end state, still. The whole drawing is
 * aria-hidden; its meaning is in the label on the figure.
 *
 * Geometry: one 560×480 frame. The SVG uses it as its viewBox and the HTML
 * pieces are placed in % of the same frame, so lines meet boxes at any size.
 */
const W = 560;
const H = 480;
const SOURCE_Y = [118, 203, 288, 373];
const SOURCE_RIGHT = 200;
const CARD = { x: 252, y: 245 };
const BAD = 2; // openingstijden.nl

const pct = (v: number, of: number) => `${(v / of) * 100}%`;
const line = (y: number) => `M${SOURCE_RIGHT} ${y} C ${SOURCE_RIGHT + 30} ${y}, ${CARD.x - 30} ${CARD.y}, ${CARD.x} ${CARD.y}`;
const REPAIR = `M262 418 C 228 418, 236 ${SOURCE_Y[BAD]}, ${SOURCE_RIGHT} ${SOURCE_Y[BAD]}`;

const RED = "#D41B44";
const GREEN = "#2B7A53";
const GREY = "#9CA3AF";

export async function HeroViz() {
  const { copy } = await getI18n();
  const V = copy.landing.hero.viz;
  return (
    <figure className="m-0 flex flex-col gap-3">
      <div className="viz" role="img" aria-label={V.label}>
        <svg className="viz-svg" viewBox={`0 0 ${W} ${H}`} aria-hidden>
          <defs>
            {SOURCE_Y.map((y, i) => (
              <path key={i} id={`viz-line-${i}`} d={line(y)} />
            ))}
          </defs>
          {/* Lines from each source into the answer. */}
          {SOURCE_Y.map((y, i) => (
            <path key={i} className={i === BAD ? "viz-bad-line" : undefined} d={line(y)} fill="none" stroke={i === BAD ? RED : "#D1D5DB"} strokeWidth={i === BAD ? 2 : 1.5} strokeLinecap="round">
              {i === BAD && <animate attributeName="stroke" dur="12s" repeatCount="indefinite" values={`${RED};${RED};${GREEN};${GREEN}`} keyTimes="0;0.54;0.57;1" />}
            </path>
          ))}
          {/* Vidalo's line to the source it repairs: drawn, held, cleared. */}
          <path className="viz-repair" d={REPAIR} pathLength={1} fill="none" stroke="#2563EB" strokeWidth={2} strokeDasharray="1" strokeLinecap="round">
            <animate attributeName="stroke-dashoffset" dur="12s" repeatCount="indefinite" values="1;1;0;0;1" keyTimes="0;0.42;0.52;0.9;1" />
          </path>
          {/* Particles: three per source, the stale one red until repaired. */}
          <g className="viz-particles">
            {SOURCE_Y.map((_, i) =>
              [0, 1, 2].map((k) => (
                <circle key={`${i}-${k}`} r={i === BAD ? 4 : 3} fill={i === BAD ? RED : GREY}>
                  <animateMotion dur={`${1.6 + i * 0.15}s`} begin={`${k * 0.55 + i * 0.2}s`} repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
                    <mpath href={`#viz-line-${i}`} />
                  </animateMotion>
                  {i === BAD && <animate attributeName="fill" dur="12s" repeatCount="indefinite" values={`${RED};${RED};${GREEN};${GREEN}`} keyTimes="0;0.55;0.57;1" />}
                  <animate attributeName="opacity" dur={`${1.6 + i * 0.15}s`} begin={`${k * 0.55 + i * 0.2}s`} repeatCount="indefinite" values="0;1;1;0" keyTimes="0;0.15;0.85;1" />
                </circle>
              )),
            )}
          </g>
          {/* A pulse where the repair lands. */}
          <circle className="viz-particles" cx={SOURCE_RIGHT} cy={SOURCE_Y[BAD]} r="6" fill="none" stroke="#2563EB" strokeWidth="2" opacity="0">
            <animate attributeName="r" dur="12s" repeatCount="indefinite" values="6;6;22;22" keyTimes="0;0.52;0.6;1" />
            <animate attributeName="opacity" dur="12s" repeatCount="indefinite" values="0;0;0.8;0;0" keyTimes="0;0.52;0.53;0.62;1" />
          </circle>
        </svg>

        <div className="viz-stage" aria-hidden>
          {/* The question. */}
          <div className="viz-q" style={{ left: pct(252, W), top: pct(28, H), width: pct(296, W) }}>
            {V.question}
          </div>

          {/* The sources. */}
          {V.sources.map((s, i) => (
            <div key={s.name} className={`viz-src ${i === BAD ? "viz-src-bad" : ""}`} style={{ left: pct(12, W), top: pct(SOURCE_Y[i]! - 30, H), width: pct(SOURCE_RIGHT - 12, W) }}>
              <span className="viz-src-name">{s.name}</span>
              {i === BAD && "fixed" in s ? (
                <span className="viz-swap">
                  <span className="viz-before">{s.meta}</span>
                  <span className="viz-after">{s.fixed}</span>
                </span>
              ) : (
                <span className="viz-src-meta">{s.meta}</span>
              )}
            </div>
          ))}

          {/* The answer. */}
          <div className="viz-card" style={{ left: pct(CARD.x, W), top: pct(CARD.y - 58, H), width: pct(296, W) }}>
            <div className="viz-card-head">
              <span>{V.engine}</span>
              <span className="viz-stip" />
            </div>
            <div className="viz-answer">
              <span className="viz-typing">
                <i />
                <i />
                <i />
              </span>
              <span className="viz-wrong">{V.wrong}</span>
              <span className="viz-right">{V.right}</span>
            </div>
          </div>

          {/* Vidalo at work. */}
          <div className="viz-vidalo" style={{ left: pct(252, W), top: pct(392, H), width: pct(296, W) }}>
            <span className="viz-vidalo-mark">vidalo</span>
            <span className="viz-swap viz-swap-3">
              {V.vidalo.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </span>
          </div>
        </div>
      </div>
      <figcaption className="text-[13px] text-muted">{V.caption}</figcaption>
    </figure>
  );
}
