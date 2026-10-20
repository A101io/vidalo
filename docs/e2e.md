# Browser tests (Playwright)

The real web app in a real browser, in the shape of the A101 kit's pack (`A101/kit/tests/e2e`). The kit's own specs test the kit's demo components; Vidalo has its own consent notice, legal pages and gate, so these specs are written for Vidalo's routes.

| Command | What runs | Needs |
|---|---|---|
| `pnpm e2e` | Every public page in NL and EN, the free check to its report, both plans through the mock checkout to `/welkom`, cookies, axe (WCAG 2.2 AA) and keyboard, no sideways scroll on a phone | nothing: mock mode, no keys |
| `pnpm e2e:gate` | The launch gate: marketing pages show `/binnenkort`, legal pages, the example report and sign-in stay reachable, the preview button opens the site | nothing |
| `pnpm e2e:stripe` | Both plans through a real Stripe **test-mode** Checkout with a test card and the btw-nummer, back on `/welkom`, every webhook answered 200 | Stripe lines in the root `.env` (test key only, refused otherwise), the Stripe CLI (`brew install stripe/stripe-cli/stripe`), the Terms and Privacy URLs on the Stripe account |

The app runs on :3100 (gate :3101), never on a dev server's :3000, and every key is set empty unless the mode needs it, so a local `.env` cannot make the suite spend money or send mail. Reports and traces land in `out/` (gitignored): `pnpm exec playwright show-report out/playwright-report`.

`e2e:stripe` starts `stripe listen` with the test key (no `stripe login` needed) for exactly the events in `STRIPE_WEBHOOK_EVENTS`, runs the `@stripe` specs, then fails if any delivery was not answered 200 or no `checkout.session.completed` arrived. To see what each event did, run it with `DEBUG=pw:webserver` and look for `billing.` lines.

## First run, 16 Oct 2026

- `pnpm e2e`: 62 passed, 11 failed, all on colour contrast (below).
- `pnpm e2e:gate`: 4 passed.
- `pnpm e2e:stripe`: both checkouts paid and back on `/welkom`; 5 webhooks, all 200.

Found and fixed on the way:
- `/en/facts` rendered Dutch (`lang="nl"`, Dutch title) because `/feiten` was `force-static`: built once, without the language header.
- `/feiten` had a `<main>` inside its `<main>` (the publisher's whole page embedded).
- An invoice in the newer Stripe API shape (`parent.subscription_details.metadata`) arriving before `checkout.session.completed` could not be placed (`billing.no_business`). Harmless for the first invoice, which is ignored; now read, with a test that fails without it.

Colour contrast below WCAG AA (4.5:1). **Applied 17 Oct 2026** (Julian): the tokens below, `.fine` on `--muted`, the light blue on the blue pricing block `#EFF6FF`, sources on the dark panel `text-grijs`, and ink text on the orange and grey status circles (white on `#f59e0b` was 2.1:1; the status colours themselves stay). After: `pnpm e2e` 73/73.

| Colour | On | Ratio | Closest that passes |
|---|---|---|---|
| muted `#6b7280` | cream `#fbf6ee`, panel `#f4f1ec` | 4.49, 4.29 | `#666d7b` (4.83, 4.62) |
| red `#e11d48` | panel `#f4f1ec` | 4.16 | `#d41b44` (4.61) |
| green `#2f855a` | panel `#f4f1ec` | 4.03 | `#2b7a53` (4.65) |
| `.fine` `#9ca3af` | cream, white | 2.35, 2.53 | `#6c7079` (4.61) |
| white | grey pill `#9ca3af` | 2.53 | pill `#70757e` (4.63) |
| light blue `#bfdbfe` / `#dee8fc` | blue `#2563eb` | 3.63, 4.19 | `#eff6ff` (4.75) or white (5.17) |
| muted `#6b7280` | dark panel `#1e293b` | 3.02 | `#9ca3af` (5.76) |

Also seen in Stripe Checkout: the btw-id type defaulted to **ES**, not NL, for a Dutch billing address in the automated browser; check once by hand whether a real Dutch visitor sees the same.
