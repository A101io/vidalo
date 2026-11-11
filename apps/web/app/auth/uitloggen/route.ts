import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase";
import { getSession, MOCK_SESSION_COOKIE } from "@/lib/session";
import { NO_STORE } from "@/lib/auth-cookies";
import { ready } from "@/lib/db";

/**
 * "Uitloggen": this browser only (feature 002, AC-3d). Other browsers of the same login stay
 * signed in; "Overal uitloggen" on the account page ends them all.
 */
export async function POST() {
  const session = await getSession();
  if (session) await (await ready()).endSignIns(session.userId, "signed_out", { sessionId: session.sessionId });
  const supabase = await createServerSupabase();
  if (supabase) await supabase.auth.signOut({ scope: "local" });
  (await cookies()).delete(MOCK_SESSION_COOKIE);
  const res = NextResponse.redirect(`${env.baseUrl}/`, 303);
  res.headers.set("cache-control", NO_STORE);
  return res;
}
