import type { MetadataRoute } from "next";
import { SECTOR_SLUGS } from "@vidalo/core/types";
import { localizeHref } from "@/lib/lang-paths";
import { copy } from "@vidalo/core/copy";
import { SITE } from "@/lib/seo";

/** Every public page in both languages, each entry naming its translation (hreflang). */
const ROUTES: { route: string; priority: number; changeFrequency: "weekly" | "monthly" | "yearly" }[] = [
  { route: "/", priority: 1, changeFrequency: "weekly" },
  { route: "/prijzen", priority: 0.9, changeFrequency: "monthly" },
  { route: "/hoe-het-werkt", priority: 0.8, changeFrequency: "monthly" },
  { route: "/waarom", priority: 0.8, changeFrequency: "monthly" },
  { route: "/straks", priority: 0.7, changeFrequency: "monthly" },
  { route: "/feiten", priority: 0.6, changeFrequency: "monthly" },
  { route: "/contact", priority: 0.4, changeFrequency: "yearly" },
  // The cookie statement describes the code, so it is never a draft.
  { route: "/cookies", priority: 0.2, changeFrequency: "yearly" },
  ...SECTOR_SLUGS.map((slug) => ({ route: `/vak/${slug}`, priority: 0.7, changeFrequency: "monthly" as const })),
  // Terms and privacy join once they are reviewed: drafts are noindex.
  ...(copy.legal.draft ? [] : [{ route: "/voorwaarden", priority: 0.2, changeFrequency: "yearly" as const }, { route: "/privacy", priority: 0.2, changeFrequency: "yearly" as const }]),
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const url = (route: string, lang: "nl" | "en") => SITE + (localizeHref(route, lang) === "/" ? "" : localizeHref(route, lang));
  return ROUTES.flatMap(({ route, priority, changeFrequency }) =>
    (["nl", "en"] as const).map((lang) => ({
      url: url(route, lang),
      lastModified,
      changeFrequency,
      priority: lang === "nl" ? priority : Math.round(priority * 8) / 10,
      alternates: { languages: { nl: url(route, "nl"), en: url(route, "en") } },
    })),
  );
}
