import { getI18n } from "@/lib/i18n";
import { turnstile } from "@/lib/turnstile";
import { TurnstileBox } from "@/components/TurnstileBox";

/**
 * Cloudflare Turnstile inside a form (lib/turnstile.ts). It adds the hidden
 * cf-turnstile-response field the server checks, and only asks the visitor
 * something when Cloudflare is unsure. Renders nothing while the check is off.
 * The widget itself is drawn on the client each time the form appears
 * (TurnstileBox), so it also works after a navigation inside the site.
 */
export async function TurnstileWidget() {
  const { mode, siteKey } = turnstile();
  if (mode !== "on" || !siteKey) return null;
  const { lang } = await getI18n();
  return <TurnstileBox siteKey={siteKey} lang={lang} />;
}
