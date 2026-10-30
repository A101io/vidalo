import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase";

/**
 * Where a sign-in may continue to: a path on this site only. "//host" and
 * "/\host" are protocol-relative URLs to another site, so they are refused.
 */
export function safeNext(raw: string | null): string {
  const next = raw ?? "/app";
  return /^\/(?![/\\])/.test(next) ? next : "/app";
}

const OTP_TYPES: readonly EmailOtpType[] = ["email", "magiclink", "signup", "invite", "recovery", "email_change"];

/**
 * Finishes a sign-in from the e-mail link, in either form:
 *  - token_hash + type: the Vidalo template's link (docs/auth-email). Works in
 *    any browser and an older link stays valid after a newer one is sent.
 *  - code: Supabase's default link (PKCE). Only works in the browser that asked
 *    for it, and only for the latest link; kept so old mails keep working.
 */
export async function confirmSignIn(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const failed = NextResponse.redirect(`${env.baseUrl}/inloggen?fout=link&next=${encodeURIComponent(next)}`);

  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.redirect(`${env.baseUrl}${next}`);
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    return error ? failed : NextResponse.redirect(`${env.baseUrl}${next}`);
  }
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return error ? failed : NextResponse.redirect(`${env.baseUrl}${next}`);
  }
  return failed;
}
