import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import "./scenes.css";
import "./logo-intro.css";
import { getCopy, getLang, getRoute, localizeHref } from "@/lib/i18n";
import { CookieConsent } from "@/components/CookieConsent";
import { PreviewBar } from "@/components/PreviewBar";
import { ChatWidget } from "@/components/ChatWidget";
import { FormMessages } from "@/components/FormMessages";
import { behindGate } from "@/lib/gate-state";
import { Trackers } from "@/components/Trackers";
import { consentCategories, trackerIds } from "@/lib/trackers";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-jakarta", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const [copy, route] = [await getCopy(), await getRoute()];
  return {
    title: { default: `${copy.brand}: ${copy.landing.hero.h1}`, template: `%s · ${copy.brand}` },
    description: copy.tagline,
    metadataBase: new URL(process.env.PUBLIC_BASE_URL ?? "http://localhost:3000"),
    // Every page exists in both languages (baseline F1: hreflang).
    alternates: { languages: { nl: localizeHref(route, "nl"), en: localizeHref(route, "en"), "x-default": localizeHref(route, "nl") } },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, colorScheme: "light", themeColor: "#FFFFFF" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [lang, copy, gated, route] = [await getLang(), await getCopy(), await behindGate(), await getRoute()];
  // The sign-in link's page loads nothing from outside and runs no script of ours (feature 002, SEC-25).
  const bare = route.startsWith("/auth/");
  const trackers = trackerIds();
  return (
    <html lang={lang} className={jakarta.variable}>
      <body className="font-sans">
        {children}
        <FormMessages messages={copy.errors.field} />
        <CookieConsent copy={copy.consent} cookiesHref={localizeHref("/cookies", lang)} categories={consentCategories(trackers)} />
        {/* GA4 and the Meta pixel: off without their id, and only after consent. */}
        {!bare && <Trackers ids={trackers} />}
        {/* Temporary, only while the launch gate is on and this browser previews the site. */}
        <PreviewBar copy={copy.comingSoon} lang={lang} />
        {/* The assistant explains the open product; behind the launch gate there is nothing to ask about yet. */}
        {!gated && !bare && <ChatWidget copy={copy.chat} lang={lang} />}
        {/* Scroll motion; hides nothing on its own, so the page is whole without it. */}
        {!bare && <script src="/motion.js" defer />}
        {!bare && <script src="/ask.js" defer />}
      </body>
    </html>
  );
}
