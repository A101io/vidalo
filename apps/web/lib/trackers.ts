import type { OptionalCategory } from "@/lib/consent";

/**
 * Third-party measurement: Google Analytics 4 and the Meta pixel. Each is off
 * until its variable is set (wrangler.jsonc vars, read per request), and each
 * only loads after its consent category is granted (components/Trackers.tsx).
 *
 *   GA4_MEASUREMENT_ID  G-XXXXXXXXXX  → "analytics"
 *   META_PIXEL_ID       15–16 digits  → "marketing"
 *
 * Both are public identifiers, not secrets. The format check keeps anything
 * else out of the script URL. Their cookies are in copy.legal.cookies and the
 * vendors in copy.legal.privacy and docs/processors.md; change those together.
 */
export interface TrackerIds {
  ga4?: string;
  metaPixel?: string;
}

export function trackerIds(): TrackerIds {
  const ga4 = process.env.GA4_MEASUREMENT_ID?.trim();
  const metaPixel = process.env.META_PIXEL_ID?.trim();
  return {
    ga4: ga4 && /^G-[A-Z0-9]{4,16}$/.test(ga4) ? ga4 : undefined,
    metaPixel: metaPixel && /^\d{10,20}$/.test(metaPixel) ? metaPixel : undefined,
  };
}

/** The consent categories the notice asks for: one per configured tracker, none when nothing is configured. */
export function consentCategories(ids = trackerIds()): OptionalCategory[] {
  return [...(ids.ga4 ? (["analytics"] as const) : []), ...(ids.metaPixel ? (["marketing"] as const) : [])];
}
