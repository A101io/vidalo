/**
 * Languages and their URLs. Dutch lives at the root (/prijzen); English
 * under /en with its own slugs (/en/pricing). The pages exist once: the
 * middleware rewrites /en/... to the Dutch route and says which language
 * to render. Pure, so the middleware (edge) and server components share it.
 */
export const LANGS = ["nl", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "nl";

/** First path segment: Dutch route → English URL. Segments not listed keep their name. */
const EN_SLUGS: Record<string, string> = {
  prijzen: "pricing",
  waarom: "why",
  "hoe-het-werkt": "how-it-works",
  straks: "whats-next",
  vak: "sectors",
  voorwaarden: "terms",
  inloggen: "login",
  afmelden: "unsubscribe",
  welkom: "welcome",
  eigenaar: "owner",
  feiten: "facts",
  binnenkort: "coming-soon",
  controle: "check",
  voorvertoning: "preview",
};
const NL_SLUGS = Object.fromEntries(Object.entries(EN_SLUGS).map(([nl, en]) => [en, nl]));

/**
 * The one nested segment that is translated: under /app, "productlijnen" is "product-lines" in English (the brief names the
 * path). Every other /app page keeps its Dutch segment under /en.
 */
const EN_APP_SLUGS: Record<string, string> = { productlijnen: "product-lines" };
const NL_APP_SLUGS = Object.fromEntries(Object.entries(EN_APP_SLUGS).map(([nl, en]) => [en, nl]));

/** Swap the second segment of /app/... through `map`; other paths come back as they were. */
function mapAppSegment(segments: string[], map: Record<string, string>): string[] {
  const [first, second, ...rest] = segments;
  if (first !== "app" || second === undefined || !Object.hasOwn(map, second)) return segments;
  return [first, map[second]!, ...rest];
}

/** A public URL path → the language and the route that renders it. */
export function fromUrl(pathname: string): { lang: Lang; route: string } {
  if (pathname !== "/en" && !pathname.startsWith("/en/")) return { lang: "nl", route: pathname };
  const rest = pathname.slice(3) || "/";
  const [, first = "", ...more] = rest.split("/");
  const route = "/" + mapAppSegment([NL_SLUGS[first] ?? first, ...more], NL_APP_SLUGS).filter((s, i) => s !== "" || i > 0).join("/");
  return { lang: "en", route: route === "/" ? "/" : route.replace(/\/$/, "") };
}

/** A route (as written in the code, Dutch) → its public URL in `lang`. Keeps ?query and #hash. */
export function localizeHref(href: string, lang: Lang): string {
  if (lang === "nl" || !href.startsWith("/") || href.startsWith("/api/") || href.startsWith("/_next/")) return href;
  const cut = href.search(/[?#]/);
  const path = cut === -1 ? href : href.slice(0, cut);
  const tail = cut === -1 ? "" : href.slice(cut);
  const [, first = "", ...more] = path.split("/");
  const out = "/en" + (first ? "/" + mapAppSegment([EN_SLUGS[first] ?? first, ...more], EN_APP_SLUGS).join("/") : "");
  return out + tail;
}
