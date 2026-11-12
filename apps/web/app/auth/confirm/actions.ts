"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase";
import { ready } from "@/lib/db";
import { localizeHref } from "@/lib/lang-paths";
import { MOCK_SESSION_COOKIE, readMockCookie } from "@/lib/session";
import { log, safeNext, uaFamily } from "@vidalo/core/shared";

/** The link types a sign-in may carry. recovery and invite are not used by Vidalo (SEC-27). */
const TYPES: readonly EmailOtpType[] = ["email", "magiclink", "signup", "email_change"];
const TOKEN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * The button on /auth/confirm (feature 002, ADR-0003). Server actions carry Next's Origin
 * check, so a foreign site cannot post this. Supabase checks the link, then the sign-in is
 * recorded (auth_session; getSession refuses a session without its row) and the browser
 * continues to `next`, a path on this site only. A sign-in this browser already had ends
 * as "replaced". The link's values never reach a log.
 */
export async function confirmSignInAction(form: FormData): Promise<void> {
  const next = safeNext(String(form.get("next") ?? ""));
  const lang = next === "/en" || next.startsWith("/en/") ? "en" : "nl";
  const failed = localizeHref(`/inloggen?fout=link&next=${encodeURIComponent(next)}`, lang);
  const tokenHash = String(form.get("token_hash") ?? "");
  const type = String(form.get("type") ?? "") as EmailOtpType;
  const code = String(form.get("code") ?? "");

  const supabase = await createServerSupabase();
  // Mock auth signs in on /inloggen itself; here it only continues.
  if (!supabase) redirect(next);

  const useHash = TOKEN.test(tokenHash) && TYPES.includes(type);
  const useCode = !useHash && TOKEN.test(code);
  if (!useHash && !useCode) redirect(failed);

  // The sign-in this browser had before, if any (verified), to end it as replaced.
  const before = (await supabase.auth.getClaims().catch(() => null))?.data?.claims;

  const { data, error } = useHash ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type }) : await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    log.info("auth.link_refused", { status: error?.status ?? null, code: error?.code ?? null });
    redirect(failed);
  }
  // Straight from Supabase's answer to this request: its claims are the new session's.
  const claims = decodeClaims(data.session.access_token);
  if (!claims) redirect(failed);
  const db = await ready();
  await db.recordSignIn({ sessionId: claims.sessionId, userId: claims.userId, ...uaFamily((await headers()).get("user-agent")), at: new Date() });
  if (before && typeof before.sub === "string" && typeof before.session_id === "string" && before.session_id !== claims.sessionId) {
    await db.endSignIns(before.sub, "replaced", { sessionId: before.session_id });
  }
  // Mock and Supabase never run together, but a stale mock cookie must not outlive a real sign-in.
  const store = await cookies();
  if (readMockCookie(store.get(MOCK_SESSION_COOKIE)?.value)) store.delete(MOCK_SESSION_COOKIE);
  redirect(next);
}

function decodeClaims(token: string): { userId: string; sessionId: string } | null {
  try {
    const p = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: unknown; session_id?: unknown };
    return typeof p.sub === "string" && typeof p.session_id === "string" ? { userId: p.sub, sessionId: p.session_id } : null;
  } catch {
    return null;
  }
}
