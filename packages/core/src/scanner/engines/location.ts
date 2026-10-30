/**
 * The location a sampled engine is told the asker is in.
 *
 * A local question ("is bakkerij X in Haarlem op zondag open?") is answered
 * from the pages the engine's own search retrieves, and that search is
 * localised to the declared location down to the city: ChatGPT writes the
 * declared place into its queries and ignores the network; Perplexity's docs
 * say city and region "significantly improve location accuracy". A sample
 * taken with only `country: "NL"` is therefore a sample for an asker
 * somewhere in the Netherlands, not for a customer in the business's town.
 * Sources: Chen & Koudas, arXiv:2610.24081 (31,200 answers, 19 declared
 * locations); OpenAI web search guide (user_location fields); Perplexity
 * user-location guide. A101/_OS/research/proposals/2026-10-25-1.md.
 */
import type { Business } from "../../types";

export const USER_COUNTRY = "NL";
export const USER_TIMEZONE = "Europe/Amsterdam";

/** OpenAI Responses API `user_location` for the business's town. */
export function openAiUserLocation(business: Pick<Business, "place">): { type: "approximate"; country: string; city?: string; timezone: string } {
  const city = business.place.trim();
  return { type: "approximate", country: USER_COUNTRY, ...(city ? { city } : {}), timezone: USER_TIMEZONE };
}

/** Perplexity `web_search_options.user_location` for the business's town. */
export function perplexityUserLocation(business: Pick<Business, "place">): { country: string; city?: string } {
  const city = business.place.trim();
  return { country: USER_COUNTRY, ...(city ? { city } : {}) };
}
