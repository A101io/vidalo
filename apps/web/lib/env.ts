/** Centralised env access. Every external SDK is guarded by one of these flags. */

const read = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim() !== "" ? v.trim() : undefined;
};

export const env = {
  get mock(): boolean {
    return read("VIDALO_MOCK") === "1" || !read("DATABASE_URL");
  },
  /** Engines answer for real (and cost money) unless VIDALO_MOCK=1, whatever the database. */
  get realEngines(): boolean {
    return read("VIDALO_MOCK") !== "1";
  },
  /**
   * Free scans the whole site may start per rolling 24 hours while the engines
   * are real. Each costs ~54 engine calls plus extraction and anyone can start
   * one, so the cap is on by default; 0 stops free scans entirely.
   */
  get freeScansPerDay(): number {
    const n = Number(read("FREE_SCANS_PER_DAY") ?? 25);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 25;
  },
  /** Launch gate (go-live J4): the marketing pages show /binnenkort (core/shared/gate.ts). */
  get comingSoon(): boolean {
    return read("VIDALO_COMING_SOON") === "1";
  },
  get previewKey() {
    return read("VIDALO_PREVIEW_KEY");
  },
  get baseUrl(): string {
    return read("PUBLIC_BASE_URL") ?? "http://localhost:3000";
  },
  get databaseUrl() {
    return read("DATABASE_URL");
  },
  get supabaseUrl() {
    return read("SUPABASE_URL") ?? read("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return read("SUPABASE_ANON_KEY") ?? read("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return read("SUPABASE_SERVICE_ROLE_KEY");
  },
  /**
   * Sign-in without Supabase (a cookie naming the e-mail) exists for mock mode
   * and local development only. A production build with real data never trusts
   * that cookie, even when the Supabase keys are missing: anyone can write it.
   */
  get allowMockAuth(): boolean {
    return read("VIDALO_MOCK") === "1" || process.env.NODE_ENV !== "production";
  },
  get hasSupabase(): boolean {
    return Boolean(this.supabaseUrl && this.supabaseAnonKey);
  },
  get stripeSecretKey() {
    return read("STRIPE_SECRET_KEY");
  },
  get stripeWebhookSecret() {
    return read("STRIPE_WEBHOOK_SECRET");
  },
  get stripePriceSetup() {
    return read("STRIPE_PRICE_SETUP");
  },
  get stripePriceMonitor() {
    return read("STRIPE_PRICE_MONITOR");
  },
  /** The 21% BTW tax rate (scripts/stripe-setup.mjs). Prices are excl. btw, so live checkout refuses without it. */
  get stripeTaxRateId() {
    return read("STRIPE_TAX_RATE_ID");
  },
  /** The customer portal configuration (scripts/stripe-setup.mjs); without it Stripe uses the account default. */
  get stripePortalConfiguration() {
    return read("STRIPE_PORTAL_CONFIGURATION");
  },
  get hasStripe(): boolean {
    return Boolean(this.stripeSecretKey);
  },
  get googleClientId() {
    return read("GOOGLE_OAUTH_CLIENT_ID");
  },
  get googleClientSecret() {
    return read("GOOGLE_OAUTH_CLIENT_SECRET");
  },
  get hasGoogle(): boolean {
    return Boolean(this.googleClientId && this.googleClientSecret);
  },
};
