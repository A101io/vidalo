import { cookies } from "next/headers";
import { env } from "./env";
import { createServerSupabase } from "./supabase";
import { ready } from "./core";
import type { BusinessRecord } from "@vidalo/core/db";

export const MOCK_SESSION_COOKIE = "vidalo_mock_session";

export interface Session {
  userId: string;
  email: string;
}

/** Current signed-in user: Supabase auth when configured, else a mock cookie set by /inloggen. */
export async function getSession(): Promise<Session | null> {
  const supabase = await createServerSupabase();
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    if (data.user?.email) return { userId: data.user.id, email: data.user.email };
    return null;
  }
  if (!env.hasSupabase && env.allowMockAuth) {
    const store = await cookies();
    const raw = store.get(MOCK_SESSION_COOKIE)?.value;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<Session>;
        if (parsed.userId && parsed.email) return { userId: parsed.userId, email: parsed.email };
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

/** The business owned by the session user, linking owner_user_id on first visit. */
export async function getOwnedBusiness(session: Session): Promise<BusinessRecord | null> {
  const db = await ready();
  let b = await db.getBusinessByOwner({ userId: session.userId });
  if (!b) {
    b = await db.getBusinessByOwner({ email: session.email });
    if (b && !b.ownerUserId) b = await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, ownerUserId: session.userId });
  } else if (b.ownerEmail?.toLowerCase() !== session.email.toLowerCase()) {
    // The owner confirmed a new address with Supabase (account page): owner mail follows the login.
    b = await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, ownerEmail: session.email.toLowerCase() });
    await db.logEvent(b.id, "account.email_changed", { via: "auth" });
  }
  return b;
}
