import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase";
import { MOCK_SESSION_COOKIE } from "@/lib/session";
import { NO_STORE } from "@/lib/auth-cookies";

export async function POST() {
  const supabase = await createServerSupabase();
  if (supabase) await supabase.auth.signOut();
  (await cookies()).delete(MOCK_SESSION_COOKIE);
  const res = NextResponse.redirect(`${env.baseUrl}/`, 303);
  res.headers.set("cache-control", NO_STORE);
  return res;
}
