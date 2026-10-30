"use client";

import { useEffect, useRef } from "react";

/**
 * The logo animation "De vraag" (docs/logo/animaties.html, study 7); styles in
 * app/logo-intro.css. The server renders the still logo; after hydration this
 * measures how wide each typed line really is (font loaded), stores it as em
 * so the clamp() font size can change without measuring again, and only then
 * adds .li-ready to start the loop. It never changes text: React's markup
 * stays exactly as rendered (CLAUDE.md: touching text before hydration makes
 * React throw the server HTML away).
 *
 * The typing steps in the keyframes are fixed per line (28, 23, 27, and 6 for
 * the name); copy.comingSoon.intro keeps those lengths in both languages, and
 * test/copy-intro.test.ts holds it to that.
 */
export function LogoIntro({ questions, name, label }: { questions: readonly [string, string, string]; name: string; label: string }) {
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let cancelled = false;

    const widthEm = (node: HTMLElement, extraEm: number) => {
      const copy = node.cloneNode(true) as HTMLElement;
      copy.className = node.className.replace(/\bli-q\d\b/, "");
      copy.style.cssText = "position:absolute;visibility:hidden;max-width:none;animation:none";
      node.parentNode!.appendChild(copy);
      const px = copy.scrollWidth;
      copy.remove();
      const base = parseFloat(getComputedStyle(el).fontSize) || 80;
      return (px + 1) / base + extraEm;
    };

    const measure = () => {
      if (cancelled) return;
      const field = el.querySelector<HTMLElement>(".li-field");
      const qs = el.querySelectorAll<HTMLElement>(".li-q");
      const nameEl = el.querySelector<HTMLElement>(".li-name");
      if (!field || !nameEl) return;
      // The still logo's width: the stage keeps it while animating, so the field grows from where the dot ends up.
      el.style.setProperty("--lw", `${(el.getBoundingClientRect().width / (parseFloat(getComputedStyle(el).fontSize) || 80)).toFixed(4)}em`);
      qs.forEach((q, i) => {
        const w = `${widthEm(q, 0.04).toFixed(4)}em`;
        q.style.setProperty("--w", `${(parseFloat(w) / 0.18).toFixed(4)}em`); // inside .li-qs, whose font is .18em
        field.style.setProperty(`--w${i + 1}`, w);
      });
      nameEl.style.setProperty("--w", `${(widthEm(nameEl, 0.06) / 0.84).toFixed(4)}em`); // .li-name is .84em
      el.classList.add("li-ready");
    };

    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) fonts.ready.then(measure, measure);
    else measure();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div ref={stage} className="li-stage" role="img" aria-label={label}>
      <span className="li-field">
        <span className="li-qs">
          {questions.map((q, i) => (
            <span key={i} className={`li-q li-q${i + 1}`}>
              {q}
            </span>
          ))}
        </span>
        <span className="li-caret" />
      </span>
      <span className="li-name">{name}</span>
      <span className="li-caret2" />
    </div>
  );
}
