"use client";

import { useEffect, useState } from "react";
import type { CopyShape } from "@vidalo/core/copy";
import { CONSENT_COOKIE, consentCookie, parseConsent, type Consent, type ConsentChoice, type OptionalCategory } from "@/lib/consent";

/** The event the footer's "Cookie-instellingen" button sends to reopen the notice. */
export const OPEN_CONSENT_EVENT = "vidalo:consent:open";

function readConsent(): Consent | null {
  const raw = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${CONSENT_COOKIE}=`))
    ?.slice(CONSENT_COOKIE.length + 1);
  return parseConsent(raw);
}

/**
 * The cookie notice. Informs when only necessary cookies exist; asks (refuse
 * and accept, same size, refuse first) for the categories of the configured
 * trackers (lib/trackers.ts consentCategories).
 * Renders nothing until it knows the cookie state, so the server HTML and
 * the first client render agree (no hydration mismatch, no flash).
 */
export function CookieConsent({ copy, cookiesHref, categories }: { copy: CopyShape["consent"]; cookiesHref: string; categories: OptionalCategory[] }) {
  const [open, setOpen] = useState(false);
  // The switches as they stand before "Bewaar mijn keuze": the stored choice, or everything off.
  const [draft, setDraft] = useState<ConsentChoice>({ analytics: false, marketing: false });
  const asksChoice = categories.length > 0;
  const none: ConsentChoice = { analytics: false, marketing: false };
  const all: ConsentChoice = { analytics: categories.includes("analytics"), marketing: categories.includes("marketing") };
  const draftFrom = (c: Consent | null): ConsentChoice => ({ analytics: Boolean(c?.analytics), marketing: Boolean(c?.marketing) });

  useEffect(() => {
    const current = readConsent();
    setDraft(draftFrom(current));
    if (!current) setOpen(true);
    const reopen = () => {
      setDraft(draftFrom(readConsent()));
      setOpen(true);
    };
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
  }, []);

  function save(choice: ConsentChoice) {
    document.cookie = consentCookie(choice, location.protocol === "https:");
    const next = readConsent();
    setDraft(draftFrom(next));
    setOpen(false);
    window.dispatchEvent(new CustomEvent("vidalo:consent", { detail: next }));
  }

  if (!open) return null;
  return (
    <aside role="dialog" aria-labelledby="consent-title" aria-describedby="consent-body" className="print:hidden fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-[520px] rounded-2xl border-[1.5px] border-line bg-white p-5 shadow-[0_8px_32px_rgba(16,18,24,0.12)] sm:left-6 sm:right-auto">
      <h2 id="consent-title" className="text-[16px] font-bold">
        {copy.title}
      </h2>
      <p id="consent-body" className="mt-1.5 text-[14px] leading-[1.5] text-ink-2">
        {asksChoice ? copy.bodyWithChoice : copy.body}{" "}
        <a href={cookiesHref} className="underline underline-offset-2">
          {copy.link}
        </a>
      </p>
      {asksChoice && (
        <ul className="mt-3 divide-y-[1px] divide-line border-y-[1px] border-line text-[14px]">
          <li className="flex items-center justify-between gap-4 py-2.5">
            <span>
              <span className="font-semibold">{copy.categories.necessary.label}</span> <span className="text-muted">{copy.categories.necessary.body}</span>
            </span>
            <span className="text-muted">{copy.on}</span>
          </li>
          {categories.map((cat) => (
            <li key={cat} className="flex items-center justify-between gap-4 py-2.5">
              <span id={`consent-${cat}`}>
                <span className="font-semibold">{copy.categories[cat].label}</span> <span className="text-muted">{copy.categories[cat].body}</span>
              </span>
              {/* A real switch per category; "Bewaar mijn keuze" stores what stands here. */}
              <button
                type="button"
                role="switch"
                aria-checked={draft[cat]}
                aria-labelledby={`consent-${cat}`}
                onClick={() => setDraft((d) => ({ ...d, [cat]: !d[cat] }))}
                className="flex shrink-0 items-center gap-2 text-[13px] text-muted"
              >
                <span className={`relative inline-block h-6 w-11 rounded-full border-[1.5px] transition-colors ${draft[cat] ? "border-ink bg-ink" : "border-line bg-white"}`}>
                  <span className={`absolute top-[2px] h-[17px] w-[17px] rounded-full transition-transform ${draft[cat] ? "left-[2px] translate-x-5 bg-white" : "left-[2px] bg-ink"}`} />
                </span>
                <span className="w-7 text-left">{draft[cat] ? copy.on : copy.off}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {asksChoice ? (
          <>
            {/* Refuse first, same variant and size as accept: the legal review's instruction, not a style choice. */}
            <button type="button" className="btn-outline h-[44px] px-5" onClick={() => save(none)}>
              {copy.refuse}
            </button>
            <button type="button" className="btn-outline h-[44px] px-5" onClick={() => save(all)}>
              {copy.accept}
            </button>
            <button type="button" className="btn-outline h-[44px] px-5" onClick={() => save(draft)}>
              {copy.save}
            </button>
          </>
        ) : (
          <button type="button" className="btn-outline h-[44px] px-5" onClick={() => save(none)}>
            {copy.ok}
          </button>
        )}
      </div>
    </aside>
  );
}

/** Footer button: reopens the notice so a choice can be changed or withdrawn (LEGAL-NL §6). */
export function CookieSettingsButton({ label, tone = "text-ink-2" }: { label: string; tone?: string }) {
  // Looks exactly like the neighbouring links: no button padding or border, the text's own size, line height and
  // colour, and only as wide as its label so the hover underline matches (`.nav-link` draws it across the box).
  return (
    <button
      type="button"
      className={`nav-link m-0 inline-block cursor-pointer self-start border-0 p-0 text-left align-baseline text-[length:inherit] leading-[inherit] ${tone}`}
      onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))}>
      {label}
    </button>
  );
}
