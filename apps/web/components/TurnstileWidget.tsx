import Script from "next/script";
import { getI18n } from "@/lib/i18n";
import { turnstile } from "@/lib/turnstile";

/**
 * Cloudflare Turnstile inside a form (lib/turnstile.ts). It adds the hidden
 * cf-turnstile-response field the server checks, and only asks the visitor
 * something when Cloudflare is unsure. Renders nothing while the check is off.
 */
export async function TurnstileWidget() {
  const { mode, siteKey } = turnstile();
  if (mode !== "on" || !siteKey) return null;
  const { lang } = await getI18n();
  return (
    <>
      <div className="cf-turnstile" data-sitekey={siteKey} data-language={lang} data-appearance="interaction-only" />
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
    </>
  );
}
