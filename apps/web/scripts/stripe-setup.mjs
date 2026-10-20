/**
 * Sets up Vidalo's Stripe account: the two prices, the 21% BTW tax rate, the
 * customer portal configuration and the webhook endpoint. Checks by default; changes nothing without --apply.
 *
 *   STRIPE_SECRET_KEY=sk_test_... VIDALO_STRIPE_ACCOUNT=acct_... \
 *   PUBLIC_BASE_URL=https://vidalo.io pnpm stripe:setup [--apply] [--live]
 *
 * Guards, because a valid key for the wrong account is silent:
 * - VIDALO_STRIPE_ACCOUNT must name the account the key belongs to, or the
 *   script stops before reading anything else. The first run without it
 *   prints the key's account, so you can check it is Vidalo's.
 * - The accounts of A101's other products are refused outright.
 * - A live key needs --live as well as --apply.
 * - Idempotent: prices are found by lookup key, the tax rate by metadata,
 *   the portal configuration by name, the webhook by URL. Running it twice creates nothing twice.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";

const OTHER_A101_ACCOUNTS = {
  acct_1UA8rHEGTq7D30VV: "Sitty",
  acct_1TyIM8EQK4LIWEDd: "Sonable",
};
const PRICES = [
  { lookup: "vidalo_setup_eur_149", product: "Vidalo Goed zetten", amount: 14900, recurring: null, env: "STRIPE_PRICE_SETUP" },
  { lookup: "vidalo_monitor_eur_49", product: "Vidalo Goed houden", amount: 4900, recurring: { interval: "month" }, env: "STRIPE_PRICE_MONITOR" },
];

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const key = process.env.STRIPE_SECRET_KEY;
const pinned = process.env.VIDALO_STRIPE_ACCOUNT;
const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
const say = (s = "") => console.log(s);
const fail = (s) => {
  console.error(`✗ ${s}`);
  process.exit(1);
};

/** The webhook events, read from the billing module so the two cannot drift. */
async function webhookEvents() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = await readFile(path.join(here, "../../../packages/core/src/billing/index.ts"), "utf8");
  const block = src.match(/STRIPE_WEBHOOK_EVENTS = \[([\s\S]*?)\]/)?.[1];
  const events = [...(block ?? "").matchAll(/"([a-z_.]+)"/g)].map((m) => m[1]);
  if (!events.length) fail("could not read STRIPE_WEBHOOK_EVENTS from packages/core/src/billing/index.ts");
  return events;
}

async function main() {
  if (!key) fail("STRIPE_SECRET_KEY is not set");
  const live = key.startsWith("sk_live_") || key.startsWith("rk_live_");
  if (apply && live && !args.has("--live")) fail("this is a LIVE key: add --live as well as --apply to change the live account");
  const stripe = new Stripe(key);

  // 1. Whose account is this? Nothing else is read before this is settled.
  const account = await stripe.accounts.retrieve();
  const name = account.settings?.dashboard?.display_name ?? account.business_profile?.name ?? "(no name)";
  say(`Key belongs to ${account.id} (${name}), ${live ? "LIVE" : "test"} mode.`);
  if (OTHER_A101_ACCOUNTS[account.id]) fail(`${account.id} is ${OTHER_A101_ACCOUNTS[account.id]}'s Stripe account, not Vidalo's. Use Vidalo's key.`);
  if (!pinned) fail(`VIDALO_STRIPE_ACCOUNT is not set. If ${account.id} (${name}) is Vidalo's account, set VIDALO_STRIPE_ACCOUNT=${account.id} and run again.`);
  if (pinned !== account.id) fail(`key is for ${account.id} (${name}) but VIDALO_STRIPE_ACCOUNT is ${pinned}. Wrong key or wrong pin; nothing changed.`);
  say(`✓ account matches VIDALO_STRIPE_ACCOUNT\n`);

  const env = {};
  let missing = 0;

  // 2. Prices, found by lookup key.
  const found = await stripe.prices.list({ lookup_keys: PRICES.map((p) => p.lookup), active: true, limit: 10 });
  for (const p of PRICES) {
    let price = found.data.find((x) => x.lookup_key === p.lookup);
    if (!price && apply) {
      const product = await stripe.products.create({ name: p.product, tax_code: "txcd_10000000", metadata: { vidalo: p.lookup } });
      price = await stripe.prices.create({
        product: product.id,
        currency: "eur",
        unit_amount: p.amount,
        tax_behavior: "exclusive",
        lookup_key: p.lookup,
        ...(p.recurring ? { recurring: p.recurring } : {}),
      });
      say(`+ created ${p.product}: ${price.id}`);
    }
    if (price) {
      if (price.unit_amount !== p.amount) fail(`${p.lookup} exists but costs ${price.unit_amount} cents, not ${p.amount}. Fix it in the dashboard; nothing changed.`);
      say(`✓ ${p.product} €${p.amount / 100}${p.recurring ? "/maand" : ""} → ${price.id}`);
      env[p.env] = price.id;
    } else {
      say(`· missing: ${p.product} (${p.lookup})`);
      missing++;
    }
  }

  // 3. The 21% BTW tax rate, exclusive (prices are shown excl. btw).
  const rates = await stripe.taxRates.list({ active: true, limit: 100 });
  let rate = rates.data.find((r) => r.metadata?.vidalo === "btw21");
  if (!rate && apply) {
    rate = await stripe.taxRates.create({ display_name: "BTW", description: "BTW 21% Nederland", percentage: 21, inclusive: false, country: "NL", jurisdiction: "NL", tax_type: "vat", metadata: { vidalo: "btw21" } });
    say(`+ created tax rate BTW 21%: ${rate.id}`);
  }
  if (rate) {
    if (rate.percentage !== 21 || rate.inclusive) fail(`tax rate ${rate.id} is not 21% exclusive; nothing changed.`);
    say(`✓ BTW 21% exclusive → ${rate.id}`);
    env.STRIPE_TAX_RATE_ID = rate.id;
  } else {
    say("· missing: tax rate BTW 21%");
    missing++;
  }

  // 4. Webhook endpoint for this site.
  if (!base) {
    say("· PUBLIC_BASE_URL not set: skipping the webhook endpoint");
  } else {
    const url = `${base}/api/stripe/webhook`;
    const events = await webhookEvents();
    const hooks = await stripe.webhookEndpoints.list({ limit: 100 });
    let hook = hooks.data.find((h) => h.url === url);
    if (hook) {
      const lacking = events.filter((e) => !hook.enabled_events.includes(e) && !hook.enabled_events.includes("*"));
      if (lacking.length && apply) {
        hook = await stripe.webhookEndpoints.update(hook.id, { enabled_events: events });
        say(`~ updated webhook events on ${hook.id}`);
      } else if (lacking.length) {
        say(`· webhook ${hook.id} is missing events: ${lacking.join(", ")}`);
        missing++;
      }
      say(`✓ webhook ${url} → ${hook.id} (its signing secret is in the dashboard; it is shown only once, at creation)`);
    } else if (apply) {
      // Pinned to the SDK's API version, so the events have the shape the
      // billing module reads; otherwise they follow the account's default.
      hook = await stripe.webhookEndpoints.create({ url, enabled_events: events, description: "Vidalo", api_version: stripe.getApiField("version") });
      say(`+ created webhook ${hook.id} for ${url}`);
      env.STRIPE_WEBHOOK_SECRET = hook.secret;
    } else {
      say(`· missing: webhook ${url}`);
      missing++;
    }
  }

  // 5. Customer portal: invoices, payment method, cancel at period end. Stripe
  // does not make an API-created configuration the default, so the portal
  // route passes this id (STRIPE_PORTAL_CONFIGURATION).
  const site = base || "https://vidalo.io";
  const portals = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  let portal = portals.data.find((c) => c.name === "Vidalo");
  if (!portal && apply) {
    portal = await stripe.billingPortal.configurations.create({
      name: "Vidalo",
      business_profile: { headline: "Vidalo: je facturen, betaalmethode en abonnement", terms_of_service_url: `${site}/voorwaarden`, privacy_policy_url: `${site}/privacy` },
      default_return_url: `${site}/app/abonnement`,
      features: {
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        customer_update: { enabled: true, allowed_updates: ["email", "address", "name", "tax_id"] },
        subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none", cancellation_reason: { enabled: true, options: ["too_expensive", "unused", "switched_service", "missing_features", "other"] } },
        subscription_update: { enabled: false },
      },
    });
    say(`+ created portal configuration ${portal.id}`);
  }
  if (portal) {
    say(`✓ portal configuration → ${portal.id}`);
    env.STRIPE_PORTAL_CONFIGURATION = portal.id;
  } else {
    say("· missing: portal configuration Vidalo");
    missing++;
  }

  say("\nFor the web app's environment:");
  for (const [k, v] of Object.entries(env)) say(`${k}=${v}`);
  if (missing && !apply) {
    say(`\n${missing} missing. Run again with --apply to create ${missing === 1 ? "it" : "them"}.`);
    process.exit(2);
  }
}

main().catch((err) => fail(err?.message ?? String(err)));
