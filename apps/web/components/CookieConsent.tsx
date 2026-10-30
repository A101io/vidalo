"use client";

import { useEffect, useState } from "react";
import type { CopyShape } from "@vidalo/core/copy";
import { CONSENT_COOKIE, OPTIONAL_CATEGORIES, consentCookie, parseConsent, type Consent } from "@/lib/consent";

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
 * and accept, same size, refuse first) once an optional category is listed.
 * Renders nothing until it knows the cookie state, so the server HTML and
 * the first client render agree (no hydration mismatch, no flash).
 */
export function CookieConsent({ copy, cookiesHref }: { copy: CopyShape["consent"]; cookiesHref: string }) {
  const [open, setOpen] = useState(false);
  const [consent, setConsent] = useState<Consent | null>(null);
  const asksChoice = OPTIONAL_CATEGORIES.length > 0;

  useEffect(() => {
    const current = readConsent();
    setConsent(current);
    if (!current) setOpen(true);
    const reopen = () => {
      setConsent(readConsent());
      setOpen(true);
    };
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
  }, []);

  function save(choice: { analytics: boolean }) {
    document.cookie = consentCookie(choice, location.protocol === "https:");
    const next = readConsent();
    setConsent(next);
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
          {OPTIONAL_CATEGORIES.map((cat) => (
            <li key={cat} className="flex items-center justify-between gap-4 py-2.5">
              <span>
                <span className="font-semibold">{copy.categories[cat].label}</span> <span className="text-muted">{copy.categories[cat].body}</span>
              </span>
              <span className="text-muted">{consent?.[cat] ? copy.on : copy.off}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {asksChoice ? (
          <>
            {/* Refuse first, same variant and size as accept: the legal review's instruction, not a style choice. */}
            <button type="button" className="btn-outline h-[44px] px-5" onClick={() => save({ analytics: false })}>
              {copy.refuse}
            </button>
            <button type="button" className="btn-outline h-[44px] px-5" onClick={() => save({ analytics: true })}>
              {copy.accept}
            </button>
          </>
        ) : (
          <button type="button" className="btn-outline h-[44px] px-5" onClick={() => save({ analytics: false })}>
            {copy.ok}
          </button>
        )}
      </div>
    </aside>
  );
}

/** Footer button: reopens the notice so a choice can be changed or withdrawn (LEGAL-NL §6). */
export function CookieSettingsButton({ label }: { label: string }) {
  return (
    <button type="button" className="nav-link text-left text-ink-2" onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))}>
      {label}
    </button>
  );
}
