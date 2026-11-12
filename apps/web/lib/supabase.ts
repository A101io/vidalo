import { cookies } from "next/headers";
import { env } from "./env";
import { authCookieOptions, forceAuthOptions } from "./auth-cookies";

type ServerClient = import("@supabase/supabase-js").SupabaseClient;

/**
 * Supabase client bound to the request cookies (RLS as the signed-in user), or null when not configured.
 * Every cookie it writes carries authCookieOptions (HttpOnly, SameSite=Lax, Secure on https, 90 days).
 */
export async function createServerSupabase(): Promise<ServerClient | null> {
  if (!env.hasSupabase) return null;
  const { createServerClient } = await import("@supabase/ssr");
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl!, env.supabaseAnonKey!, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list: { name: string; value: string; options?: Record<string, unknown> }[]) => {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, forceAuthOptions(options));
        } catch {
          // Called from a server component: the middleware already refreshed the session for this request.
        }
      },
    },
  }) as unknown as ServerClient;
}

/** Service-role client for writes that must bypass RLS (auth admin, linking owner_user_id). */
export async function createAdminSupabase(): Promise<ServerClient | null> {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false } });
}
