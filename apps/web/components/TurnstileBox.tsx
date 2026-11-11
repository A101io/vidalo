"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
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
    loadTurnstile()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        // response-field-name keeps the field the server reads (lib/turnstile.ts, TURNSTILE_FIELD).
        id = window.turnstile.render(ref.current, { sitekey: siteKey, language: lang, appearance: "interaction-only", "response-field-name": "cf-turnstile-response" });
      })
      .catch(() => {
        // No script: the server refuses the form and says why; nothing to do here.
      });
    return () => {
      cancelled = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [siteKey, lang]);
  return <div ref={ref} />;
}
