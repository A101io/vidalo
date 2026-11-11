import { cookies } from "next/headers";
import { env } from "./env";
import { createServerSupabase } from "./supabase";
import { getActiveBusiness } from "./active-business";

export const MOCK_SESSION_COOKIE = "vidalo_mock_session";

/** Placeholder for signedInAt until lane A fills it: never fresh. */
const NEVER = "1970-01-01T00:00:00.000Z";

export interface Session {
  userId: string;
  email: string;
  /** Supabase JWT claim `session_id`; in mock auth the `sid` in the mock cookie. "" = unknown (C-00 stub only). */
  sessionId: string;
  /** auth_session.signed_in_at of this browser's sign-in, ISO. C-00 stub: "1970-01-01T00:00:00.000Z" (never fresh). */
  signedInAt: string;
}

/** Current signed-in user: Supabase auth when configured, else a mock cookie set by /inloggen. */
export async function getSession(): Promise<Session | null> {
  const supabase = await createServerSupabase();
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    if (data.user?.email) return { userId: data.user.id, email: data.user.email, sessionId: "", signedInAt: NEVER };
    return null;
  }
  if (!env.hasSupabase && env.allowMockAuth) {
    const store = await cookies();
    const raw = store.get(MOCK_SESSION_COOKIE)?.value;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { userId?: string; email?: string; sid?: unknown; signedInAt?: unknown };
        if (parsed.userId && parsed.email) {
          return {
            userId: parsed.userId,
            email: parsed.email,
            sessionId: typeof parsed.sid === "string" ? parsed.sid : "",
            signedInAt: typeof parsed.signedInAt === "string" ? parsed.signedInAt : NEVER,
          };
        }
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

/** @deprecated Alias of getActiveBusiness (lib/active-business.ts), kept so the existing callers need no edit. */
export const getOwnedBusiness = getActiveBusiness;
