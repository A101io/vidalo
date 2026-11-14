import type { MetadataRoute } from "next";
import { SITE } from "@/lib/seo";

// Reports (/r/...) are private links and also carry noindex; the dashboard,
// API and scan flow are never useful in a search result.
const PRIVATE = ["/r/", "/en/r/", "/app", "/en/app", "/api/", "/scan/", "/en/scan/", "/auth/", "/welkom", "/en/welcome", "/feiten/", "/en/facts/", "/afmelden", "/en/unsubscribe", "/controle", "/en/check"];

/**
 * Search engines and AI assistants are welcome on every public page: being
 * read correctly by them is what Vidalo sells. The AI crawlers are named so
 * that intent is explicit, not left to the wildcard.
 */
export default function robots(): MetadataRoute.Robots {
  const ai = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended", "Applebot-Extended", "Bingbot"];
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE }, ...ai.map((userAgent) => ({ userAgent, allow: "/", disallow: PRIVATE }))],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
