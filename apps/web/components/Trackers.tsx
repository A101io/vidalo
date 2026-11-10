"use client";

import { useEffect } from "react";
import { CONSENT_COOKIE, parseConsent, type Consent } from "@/lib/consent";
import type { TrackerIds } from "@/lib/trackers";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown };
    _fbq?: unknown;
  }
}

function readConsent(): Consent | null {
  const raw = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${CONSENT_COOKIE}=`))
    ?.slice(CONSENT_COOKIE.length + 1);
  return parseConsent(raw);
}

/**
 * GA4 in Consent Mode v2, denied by default, so gtag writes no _ga before the
 * update. Its config sends the page_view for the page the visitor accepted on
 * (the landing view paid traffic arrives on, LEGAL-NL §6); enhanced
 * measurement counts later client-side navigations.
 */
function loadGa4(id: string, consent: Consent) {
  if (window.gtag) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // gtag reads `arguments` by identity; a rest array does not work.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag("consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" });
  updateGa4(consent);
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
  window.gtag("js", new Date());
  window.gtag("config", id);
}

function updateGa4(consent: Consent) {
  window.gtag?.("consent", "update", {
    analytics_storage: consent.analytics ? "granted" : "denied",
    ad_storage: consent.marketing ? "granted" : "denied",
    ad_user_data: consent.marketing ? "granted" : "denied",
    ad_personalization: consent.marketing ? "granted" : "denied",
  });
}

/** Meta's documented snippet, de-minified. The pixel counts later client-side navigations itself (history events). */
function loadMetaPixel(id: string) {
  if (window.fbq) return window.fbq("consent", "grant");
  const fbq = function (...args: unknown[]) {
    const f = window.fbq!;
    if (f.callMethod) f.callMethod(...args);
    else f.queue!.push(args);
  } as NonNullable<Window["fbq"]>;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  window.fbq = fbq;
  window._fbq = fbq;
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(s);
  fbq("init", id);
  fbq("track", "PageView");
}

/** A loaded script cannot be unloaded; on withdrawal remove what it stored, and the next page load does not start it again. */
function clearCookies(names: (n: string) => boolean) {
  const host = location.hostname;
  const domains = [host, `.${host}`, `.${host.split(".").slice(-2).join(".")}`];
  for (const name of document.cookie.split("; ").map((c) => c.split("=")[0] ?? "").filter(names)) {
    for (const d of domains) document.cookie = `${name}=; Max-Age=0; Path=/; Domain=${d}`;
    document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

/**
 * The Stripe checkout session id in the /welkom and /inloggen URLs is proof of
 * payment for linking the business (core/shared/claim.ts); GA4 and Meta report
 * the full URL, so it leaves the address bar before either loads. The links and
 * forms on the page were rendered with it already.
 */
function dropCheckoutId() {
  const url = new URL(location.href);
  if (!url.searchParams.has("session_id")) return;
  url.searchParams.delete("session_id");
  history.replaceState(history.state, "", url);
}

function apply(ids: TrackerIds, consent: Consent | null) {
  if (!consent) return;
  if ((ids.ga4 && consent.analytics) || (ids.metaPixel && consent.marketing)) dropCheckoutId();
  if (ids.ga4) {
    if (consent.analytics) loadGa4(ids.ga4, consent);
    else {
      updateGa4(consent);
      clearCookies((n) => n === "_ga" || n.startsWith("_ga_"));
    }
  }
  if (ids.metaPixel) {
    if (consent.marketing) loadMetaPixel(ids.metaPixel);
    else {
      window.fbq?.("consent", "revoke");
      clearCookies((n) => n === "_fbp");
    }
  }
}

/** Loads GA4 and the Meta pixel only after their category is accepted in the cookie notice; renders nothing. */
export function Trackers({ ids }: { ids: TrackerIds }) {
  useEffect(() => {
    if (!ids.ga4 && !ids.metaPixel) return;
    apply(ids, readConsent());
    const onChange = (e: Event) => apply(ids, (e as CustomEvent<Consent | null>).detail ?? readConsent());
    window.addEventListener("vidalo:consent", onChange);
    return () => window.removeEventListener("vidalo:consent", onChange);
  }, [ids]);
  return null;
}
