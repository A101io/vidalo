/**
 * A small stand-in for Supabase Auth (GoTrue) for the session tests
 * (feature 002, A-01/A-02/A-03). The hosted project is production, so the
 * session lifetime is tested against this instead (F-003).
 *
 * What it does, like GoTrue:
 *  - POST /auth/v1/otp: "sends" a sign-in link; the token_hash is kept for the test to read.
 *  - POST /auth/v1/verify { token_hash, type }: one use per token_hash; starts a session.
 *  - POST /auth/v1/token?grant_type=refresh_token: rotates the refresh token. Reusing a used
 *    token after REUSE_MS revokes the whole session (refresh-token reuse detection).
 *  - GET /auth/v1/user: checks the HS256 signature, expiry and that the session is alive.
 *  - POST /auth/v1/logout?scope=local|global|others.
 *  - GET /auth/v1/.well-known/jwks.json: no keys (HS256, so supabase-js calls /user).
 * Access tokens live ACCESS_SECONDS (125 by default). The middleware refreshes a token
 * 120 seconds before it expires (apps/web/middleware.ts, REFRESH_AHEAD_MS), so it needs a refresh
 * 5 seconds after it was issued: in effect the architecture's "5-second access tokens". A token
 * that truly lived 5 seconds would be refreshed on every call by supabase-js itself, which
 * refreshes anything within 90 seconds of expiry (EXPIRY_MARGIN_MS); no real project does that
 * (Supabase's default is 3600 s).
 *
 * Test-only endpoints under /__test: health, link (make a token_hash for an address
 * without a mail), mails (what /otp "sent"), stats (calls per endpoint, refreshes per
 * session), reset.
 *
 * Run: tsx e2e/fixtures/fake-gotrue.ts (port FAKE_GOTRUE_PORT, default 54399).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, randomBytes, randomUUID } from "node:crypto";

const PORT = Number(process.env.FAKE_GOTRUE_PORT ?? 54399);
const SECRET = process.env.FAKE_GOTRUE_SECRET ?? "fake-gotrue-secret-for-tests-only";
const ACCESS_SECONDS = Number(process.env.FAKE_GOTRUE_ACCESS_SECONDS ?? 125);
/** GoTrue allows a used refresh token again for a short while (concurrent requests); after that, reuse revokes. */
const REUSE_MS = Number(process.env.FAKE_GOTRUE_REUSE_MS ?? 2000);
const VALID_TYPES = new Set(["email", "magiclink", "signup", "email_change", "recovery", "invite"]);

interface User { id: string; email: string; created_at: string }
interface Sess { id: string; userId: string; revoked: boolean; current: string; refreshes: number }
interface Rt { token: string; sessionId: string; usedAt: number | null; child: string | null }

const users = new Map<string, User>(); // by email
const sessions = new Map<string, Sess>();
const refreshTokens = new Map<string, Rt>();
const links = new Map<string, { email: string; type: string; used: boolean }>();
const mails: { email: string; tokenHash: string; redirectTo: string | null; at: string }[] = [];
const calls: Record<string, number> = {};
const events: { kind: string; sessionId?: string; detail?: string; at: number }[] = [];

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: Record<string, unknown>): string {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

function verify(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts as [string, string, string];
  let header: { alg?: string };
  try {
    header = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "HS256") return null;
  const expected = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  if (expected !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * The login that owns the mock demo business (apps/web/lib/demo.ts, demo-owner-area.ts: ownerUserId "mock-user-1").
 * Since lane B's membership (SEC-11: an address links only unowned businesses) a random id for this address owns
 * nothing, and every owner page sent it to /inloggen?fout=geen (QA, phase 4, V-QA-01).
 */
const FIXED_USER_IDS: Record<string, string> = { "eigenaar@bakkerijdevries.nl": "mock-user-1" };

function userFor(email: string): User {
  const key = email.toLowerCase();
  let u = users.get(key);
  if (!u) {
    u = { id: FIXED_USER_IDS[key] ?? randomUUID(), email: key, created_at: new Date().toISOString() };
    users.set(key, u);
  }
  return u;
}

function userJson(u: User) {
  return { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.created_at, app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [], created_at: u.created_at, updated_at: u.created_at, is_anonymous: false };
}

function issue(sess: Sess, u: User) {
  const now = Math.floor(Date.now() / 1000);
  const access = sign({ sub: u.id, email: u.email, session_id: sess.id, aud: "authenticated", role: "authenticated", aal: "aal1", amr: [{ method: "otp", timestamp: now }], iat: now, exp: now + ACCESS_SECONDS, is_anonymous: false });
  const refresh = randomBytes(16).toString("hex");
  refreshTokens.set(refresh, { token: refresh, sessionId: sess.id, usedAt: null, child: null });
  sess.current = refresh;
  return { access_token: access, token_type: "bearer", expires_in: ACCESS_SECONDS, expires_at: now + ACCESS_SECONDS, refresh_token: refresh, user: userJson(u) };
}

function startSession(u: User) {
  const sess: Sess = { id: randomUUID(), userId: u.id, revoked: false, current: "", refreshes: 0 };
  sessions.set(sess.id, sess);
  events.push({ kind: "session.start", sessionId: sess.id, at: Date.now() });
  return issue(sess, u);
}

function userById(id: string): User | undefined {
  for (const u of users.values()) if (u.id === id) return u;
  return undefined;
}

function send(res: ServerResponse, status: number, body?: unknown) {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function err(res: ServerResponse, status: number, code: string, msg: string) {
  send(res, status, { code: status, error_code: code, msg });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** The bearer's claims and live session, or null (expired, bad signature, revoked or unknown session). */
function authed(req: IncomingMessage): { claims: Record<string, unknown>; sess: Sess; user: User } | null {
  const h = req.headers.authorization ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  const claims = verify(token);
  if (!claims) return null;
  const sess = sessions.get(String(claims.session_id));
  const user = userById(String(claims.sub));
  if (!sess || sess.revoked || !user) return null;
  return { claims, sess, user };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  const key = `${req.method} ${path}${path === "/auth/v1/token" ? `?${url.searchParams.get("grant_type")}` : ""}`;
  calls[key] = (calls[key] ?? 0) + 1;

  // ---- test-only ----
  if (path === "/__test/health") return send(res, 200, { ok: true });
  if (path === "/__test/reset" && req.method === "POST") {
    users.clear(); sessions.clear(); refreshTokens.clear(); links.clear(); mails.length = 0; events.length = 0;
    for (const k of Object.keys(calls)) delete calls[k];
    return send(res, 200, { ok: true });
  }
  if (path === "/__test/link" && req.method === "POST") {
    const body = await readJson(req);
    const email = String(body.email ?? "").toLowerCase();
    const tokenHash = `pkce_${randomBytes(20).toString("hex")}`;
    userFor(email);
    links.set(tokenHash, { email, type: String(body.type ?? "email"), used: false });
    return send(res, 200, { token_hash: tokenHash });
  }
  if (path === "/__test/mails") {
    const email = url.searchParams.get("email");
    return send(res, 200, email ? mails.filter((m) => m.email === email.toLowerCase()) : mails);
  }
  if (path === "/__test/stats") {
    const perSession = [...sessions.values()].map((s) => ({ id: s.id, revoked: s.revoked, refreshes: s.refreshes }));
    return send(res, 200, { calls, sessions: perSession, events });
  }

  // ---- GoTrue ----
  if (path === "/auth/v1/.well-known/jwks.json") return send(res, 200, { keys: [] });
  if (path === "/auth/v1/settings") return send(res, 200, { external: { email: true }, disable_signup: false, mailer_autoconfirm: false });

  if (path === "/auth/v1/otp" && req.method === "POST") {
    const body = await readJson(req);
    const email = String(body.email ?? "").toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(res, 400, "validation_failed", "Unable to validate email address: invalid format");
    userFor(email);
    const tokenHash = `pkce_${randomBytes(20).toString("hex")}`;
    links.set(tokenHash, { email, type: "magiclink", used: false });
    mails.push({ email, tokenHash, redirectTo: url.searchParams.get("redirect_to"), at: new Date().toISOString() });
    return send(res, 200, {});
  }

  if (path === "/auth/v1/verify" && req.method === "POST") {
    const body = await readJson(req);
    const tokenHash = String(body.token_hash ?? "");
    const type = String(body.type ?? "");
    const link = links.get(tokenHash);
    if (!link || link.used || !VALID_TYPES.has(type)) return err(res, 403, "otp_expired", "Email link is invalid or has expired");
    link.used = true;
    events.push({ kind: "verify", at: Date.now() });
    return send(res, 200, startSession(userFor(link.email)));
  }

  if (path === "/auth/v1/token" && req.method === "POST" && url.searchParams.get("grant_type") === "refresh_token") {
    const body = await readJson(req);
    const rt = refreshTokens.get(String(body.refresh_token ?? ""));
    if (!rt) return err(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
    const sess = sessions.get(rt.sessionId);
    if (!sess || sess.revoked) return err(res, 400, "session_not_found", "Session not found");
    const user = userById(sess.userId)!;
    if (rt.usedAt !== null) {
      // Reuse: tolerated briefly (two requests at once), otherwise the session is revoked.
      if (Date.now() - rt.usedAt <= REUSE_MS && rt.child) {
        const childRt = refreshTokens.get(rt.child)!;
        const now = Math.floor(Date.now() / 1000);
        const access = sign({ sub: user.id, email: user.email, session_id: sess.id, aud: "authenticated", role: "authenticated", aal: "aal1", amr: [{ method: "otp", timestamp: now }], iat: now, exp: now + ACCESS_SECONDS, is_anonymous: false });
        events.push({ kind: "refresh.reuse_tolerated", sessionId: sess.id, at: Date.now() });
        return send(res, 200, { access_token: access, token_type: "bearer", expires_in: ACCESS_SECONDS, expires_at: now + ACCESS_SECONDS, refresh_token: childRt.token, user: userJson(user) });
      }
      sess.revoked = true;
      events.push({ kind: "refresh.reuse_revoked", sessionId: sess.id, at: Date.now() });
      return err(res, 400, "refresh_token_already_used", "Invalid Refresh Token: Already Used");
    }
    rt.usedAt = Date.now();
    sess.refreshes += 1;
    const out = issue(sess, user);
    rt.child = out.refresh_token;
    events.push({ kind: "refresh", sessionId: sess.id, at: Date.now() });
    return send(res, 200, out);
  }

  if (path === "/auth/v1/user" && req.method === "GET") {
    const a = authed(req);
    if (!a) return err(res, 403, "session_not_found", "Session from session_id claim in JWT does not exist");
    return send(res, 200, userJson(a.user));
  }

  if (path === "/auth/v1/user" && req.method === "PUT") {
    const a = authed(req);
    if (!a) return err(res, 401, "no_authorization", "This endpoint requires a valid Bearer token");
    const body = await readJson(req);
    if (typeof body.email === "string") {
      const tokenHash = `pkce_${randomBytes(20).toString("hex")}`;
      links.set(tokenHash, { email: body.email.toLowerCase(), type: "email_change", used: false });
      mails.push({ email: body.email.toLowerCase(), tokenHash, redirectTo: url.searchParams.get("redirect_to"), at: new Date().toISOString() });
    }
    return send(res, 200, userJson(a.user));
  }

  if (path === "/auth/v1/logout" && req.method === "POST") {
    const a = authed(req);
    if (!a) return send(res, 204);
    const scope = url.searchParams.get("scope") ?? "global";
    for (const s of sessions.values()) {
      if (s.userId !== a.user.id) continue;
      if (scope === "global" || (scope === "local" && s.id === a.sess.id) || (scope === "others" && s.id !== a.sess.id)) s.revoked = true;
    }
    events.push({ kind: `logout.${scope}`, sessionId: a.sess.id, at: Date.now() });
    return send(res, 204);
  }

  return err(res, 404, "not_found", `fake GoTrue has no ${req.method} ${path}`);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[fake-gotrue] listening on http://127.0.0.1:${PORT} (access tokens ${ACCESS_SECONDS}s)`);
});
