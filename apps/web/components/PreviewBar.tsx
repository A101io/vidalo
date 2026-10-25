"use client";

import { useEffect, useState } from "react";
import type { CopyShape } from "@vidalo/core/copy";
import { localizeHref, type Lang } from "@/lib/lang-paths";

/**
 * Temporary: while the launch gate is on and this browser has the preview
 * cookie, a bar at the bottom with a link to every part of the site and a
 * way back to /binnenkort. Asks /api/preview once, so static pages (the
 * sector pages are prerendered) show it too without reading cookies at
 * build time. Gone by itself once VIDALO_COMING_SOON is off.
 */
export function PreviewBar({ copy, lang }: { copy: CopyShape["comingSoon"]; lang: Lang }) {
  const href = (route: string) => localizeHref(route, lang);
  const [show, setShow] = useState(false);
  useEffect(() => {
    fetch("/api/preview", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { comingSoon?: boolean; preview?: boolean } | null) => setShow(Boolean(s?.comingSoon && s?.preview)))
      .catch(() => setShow(false));
  }, []);
  if (!show) return null;
  return (
    <nav aria-label={copy.barTitle} className="print:hidden fixed bottom-0 left-0 right-0 z-40 border-t-[1.5px] border-ink bg-ink text-white">
      <div className="wrap flex flex-wrap items-center gap-x-5 gap-y-1.5 py-2.5 text-[13px]">
        <span className="font-bold">{copy.barTitle}</span>
        {copy.barLinks.map((l) => (
          <a key={l.href} href={href(l.href)} className="opacity-85 hover:opacity-100 hover:underline">
            {l.label}
          </a>
        ))}
        <form action="/api/preview" method="post" className="ml-auto">
          <input type="hidden" name="action" value="uit" />
          <input type="hidden" name="lang" value={copy.lang} />
          <button type="submit" className="rounded-pill border-[1.5px] border-white/60 px-3 py-1 font-semibold hover:border-white">
            {copy.barExit}
          </button>
        </form>
      </div>
    </nav>
  );
}
