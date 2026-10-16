# Secrets and keys (baseline A4)

Every secret: where it comes from, where it is set, how to prove it landed. When a credential is "definitely set" and something still fails, **list the NAMES the job can see first** (Sitty lost 17 deploy runs to `CLOUDFLARE_API_SECRET` vs `_TOKEN`). `pnpm scan:secrets` fails CI on anything key-shaped in a tracked file.

## Deploying (GitHub → Cloudflare)

Set on **both** GitHub environments of `A101io/vidalo` (Settings → Environments → `preview` and `production` → Environment secrets; an environment does not inherit a repository secret of the same name):

| Name | Comes from | Prove it |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Create Token → **Create Custom Token**. The exact permission set is in "The deploy token" below. | The deploy workflow's "Require the Cloudflare credentials" step passes; on a miss it prints the secret names it can see |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → Account ID in the right column (the same account as Sitty and Sonable) | `wrangler deploy` names the account it deployed to |


### The deploy token (`CLOUDFLARE_API_TOKEN`, written 16 Oct 2026)

One token, used only by `.github/workflows/deploy.yml`, stored twice: on the `preview` and on the `production` GitHub environment. Create it at https://dash.cloudflare.com/profile/api-tokens → Create Token → Create Custom Token.

Token name: `vidalo-deploy (GitHub Actions)`

Permissions, exactly these seven rows (the form has three dropdowns per row: scope · group · level):

| Scope | Permission group | Level | Why |
|---|---|---|---|
| Account | Workers Scripts | Edit | `wrangler deploy` for `vidalo-web`, `vidalo-worker`, `vidalo-web-preview`; also creates the two production Workers, which do not exist yet (only `vidalo-web-preview` does, checked 16 Oct 2026). Cron triggers, `workers_dev`, observability and source maps ride on this |
| Account | Workers Tail | Read | `wrangler tail` when a deploy misbehaves; harmless otherwise |
| Account | Queues | Edit | `wrangler queues info vidalo-scans` / `queues create` in the production job, and the consumer binding on `vidalo-worker` |
| Account | Hyperdrive | Edit | `wrangler hyperdrive create vidalo-db` once `DATABASE_URL` exists (X2b); may be left off and added later |
| Account | Account Settings | Read | wrangler resolves the account it deploys to |
| User | User Details | Read | `wrangler whoami`; wrangler reads the user on every command |
| Zone | Workers Routes | Edit | The production deploy binds `vidalo.io` and `www.vidalo.io` as Custom Domains (`apps/web/wrangler.jsonc`). Cloudflare: Custom Domains need *Zone › Workers Routes › Edit* on every affected zone, and the zone must be active (it is: `5d39e2dacc81b8603d5dc69a163b6bca`) |

Resources:
- Account Resources: **Include · Julian.devriend@a101.io's Account** (`37c9615a0d7d9629154eca03d7de59a6`), not "All accounts".
- Zone Resources: **Include · Specific zone · vidalo.io**. Not "All zones": the same account holds Sitty's and Sonable's zones.
- Client IP Address Filtering: leave empty (GitHub's runner IPs change).
- TTL: leave empty; rotate by hand when a deploy fails authentication.

Not on this token, on purpose: DNS Edit (Custom Domains create their own records), SSL and Certificates (that is the runtime token below), KV, R2, D1, Pages.

After "Continue to summary" → "Create Token", the secret shows once. Paste it as `CLOUDFLARE_API_TOKEN` under GitHub → Settings → Environments → `preview` → Environment secrets, and again under `production`, together with `CLOUDFLARE_ACCOUNT_ID` = `37c9615a0d7d9629154eca03d7de59a6`. Prove it before trusting it: the token page offers a `curl .../user/tokens/verify` line; it must return `"status":"active"`. Then run the workflow with target `preview`: it redeploys `vidalo-web-preview` and ends with `verify-deploy.mjs` 7/7.

Cloudflare has moved to Workers *roles* (Admin / Editor / Metadata Read-Only) next to the classic permission groups above. If the Create Token form offers roles instead of "Workers Scripts": pick **Workers · Admin** at the Workers product scope (Editor cannot create a Worker that does not exist yet), keep the Queues, Hyperdrive and Zone rows as they are.

### The runtime token (facts hosts, later)

`CLOUDFLARE_API_TOKEN` as a **Worker secret** on `vidalo-worker` is a different token from the deploy token: it verifies customers' facts hosts through Cloudflare for SaaS. Create it only when D6 (fallback origin on `feiten.vidalo.io`) is built. Permissions: *Zone · SSL and Certificates · Edit* and *Zone · DNS · Edit*, zone `vidalo.io` only, with `CLOUDFLARE_ZONE_ID` = `5d39e2dacc81b8603d5dc69a163b6bca`. Nothing from the deploy token.

## On the Workers (`wrangler secret put NAME --name vidalo-web` / `--name vidalo-worker`)

Production refuses to serve without `DATABASE_URL` or a Hyperdrive binding (503, `apps/web/worker.ts`); it never falls back to mock data.

| Name | Comes from | Set in | Prove it |
|---|---|---|---|
| `DATABASE_URL` | Supabase → Project `bbynmqvaxpjdnkaasutd` → Connect → pooler, service role | Web + worker host env | `/api/health` returns `"db":"pg"` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Supabase → API | Web host env | Sign-in email arrives |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API | Worker env only; never `NEXT_PUBLIC_` | Worker claims a job |
| `OPENAI_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY`, `SERPAPI_KEY` | Each provider | Worker + web env | A scan with `VIDALO_MOCK=0` has samples from that engine |
| `GOOGLE_PLACES_API_KEY`, `KVK_API_KEY` | Google Cloud, KvK | Web env | `/scan/kies` lists businesses |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET` | Google Cloud OAuth client | Web env | Verification sets `owner_verified_at` |
| `STRIPE_SECRET_KEY` | Vidalo's own Stripe account (not Sitty `acct_1UA8rHEGTq7D30VV`, not Sonable `acct_1TyIM8EQK4LIWEDd`) | Web env; GitHub environment secret for setup | `pnpm stripe:setup` prints the account id; pin it as `VIDALO_STRIPE_ACCOUNT` |
| `STRIPE_WEBHOOK_SECRET` | Printed once by `pnpm stripe:setup --apply` | Web env | A test event reaches `/api/stripe/webhook` with 200 |
| `STRIPE_PRICE_SETUP/MONITOR`, `STRIPE_TAX_RATE_ID`, `STRIPE_PORTAL_CONFIGURATION` | `pnpm stripe:setup` output | Web env | Checkout opens with €149 + 21% btw |
| `RESEND_API_KEY` | Resend | Worker + web env | A report mail arrives |
| `UNSUBSCRIBE_SECRET` | `openssl rand -hex 32` | Worker + web env | Unsubscribe link works; without it follow-ups are not sent |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID` | Cloudflare; zone id of `vidalo.io` is `5d39e2dacc81b8603d5dc69a163b6bca` (active since 16 Oct 2026, account `37c9615a0d7d9629154eca03d7de59a6`) | Worker env | A facts host verifies |
| `INDEXNOW_KEY` | Any random string | Worker env | `/indexnow-key.txt` on a facts host |

Nothing above is set anywhere yet except in local `.env` for mock mode.
