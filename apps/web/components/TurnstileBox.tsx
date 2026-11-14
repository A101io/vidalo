"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
      reset?: (id: string) => void;
    };
    __vidaloTurnstile?: Promise<void>;
  }
}

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Load Cloudflare's script once per page life; every widget waits for the same load. */
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!window.__vidaloTurnstile) {
    window.__vidaloTurnstile = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        window.__vidaloTurnstile = undefined;
        reject(new Error("turnstile script failed to load"));
      };
      document.head.appendChild(s);
    });
  }
  return window.__vidaloTurnstile;
}

/**
 * The widget, rendered explicitly every time the form mounts. With the implicit
 * mode the script scans the page once when it loads, so a form reached through
 * a link inside the site (a client-side navigation) or redrawn after an error
 * never got a widget, posted no token, and sign-in said "We konden niet nagaan
 * dat je geen robot bent" on every try (vidalo.ai, 11 Nov 2026: 68 solved
 * challenges, 1 token checked by the server).
 */
export function TurnstileBox({ siteKey, lang }: { siteKey: string; lang: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let id: string | null = null;
    let cancelled = false;
    const form = ref.current?.closest("form") ?? null;
    // A submit before Cloudflare has handed out the token posted an empty field and
    // the server refused it: the first sign-in on a fresh visit failed, the second
    // worked (vidalo.ai, 13 Nov 2026). Hold such a submit and send it once the token is in.
    let held: { submitter: HTMLElement | null } | null = null;
    let scriptFailed = false;
    const field = () => form?.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]') ?? null;
    const hasToken = () => Boolean((field()?.value ?? "").trim());
    /** Send the held submit, if any. */
    const release = () => {
      if (!held || !form) return;
      const { submitter } = held;
      held = null;
      form.requestSubmit(submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement ? submitter : undefined);
    };
    /** No token is coming (script, widget or challenge failed): stop holding; the server refuses the form and says why. */
    const giveUp = () => {
      scriptFailed = true;
      release();
    };
    /**
     * A token is single-use (siteverify answers "timeout-or-duplicate" the second time) and lives 5 minutes. Once a
     * submit has sent it, the field must not offer it again: a form that stays on the page (a server action that
     * answers with an error) or comes back from the browser's back/forward cache would post the spent token and
     * the server would say "we could not tell you are not a robot" although nothing was wrong (13 Nov 2026).
     * Ask Cloudflare for a fresh token and empty the field; a submit in between is held like on a first visit.
     */
    const renew = () => {
      const f = field();
      if (f) f.value = "";
      if (id && window.turnstile?.reset) window.turnstile.reset(id);
    };
    const onSubmit = (e: SubmitEvent) => {
      // Also while the script is still loading (no widget yet): that is the common case on a first visit.
      if (scriptFailed) return;
      if (hasToken()) {
        // The token goes out with this submit. If the page is still here a moment later, it did not navigate away.
        window.setTimeout(() => {
          if (!cancelled) renew();
        }, 1500);
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      held = { submitter: e.submitter };
    };
    // Capture phase on the form runs before React's listener at the root, so a held submit never reaches the server action.
    form?.addEventListener("submit", onSubmit, true);
    // Back to this page from the browser's cache: the form comes back with the token it already spent.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) renew();
    };
    window.addEventListener("pageshow", onPageShow);
    loadTurnstile()
      .then(() => {
        if (cancelled || !ref.current) return;
        if (!window.turnstile) return giveUp();
        // response-field-name keeps the field the server reads (lib/turnstile.ts, TURNSTILE_FIELD).
        id = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          language: lang,
          appearance: "interaction-only",
          "response-field-name": "cf-turnstile-response",
          callback: (token: string) => {
            // Write the token ourselves rather than rely on when the script fills the field.
            const f = field();
            if (f && token) f.value = token;
            release();
          },
          // The token ran out (5 minutes) or the challenge timed out: never offer the old one.
          "expired-callback": () => {
            const f = field();
            if (f) f.value = "";
          },
          "error-callback": giveUp,
        });
      })
      .catch(giveUp);
    return () => {
      cancelled = true;
      form?.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("pageshow", onPageShow);
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [siteKey, lang]);
  return <div ref={ref} />;
}
