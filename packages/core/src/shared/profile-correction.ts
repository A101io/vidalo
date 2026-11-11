import type { BusinessProfile } from "../types.js";
import type { Db, BusinessRecord } from "../db/types.js";
import { effectiveProfile, parseOwnerProfile, type OwnerProfileField } from "../scanner/understand.js";

export type ProfileFormFields = { mode?: string; offer?: string; audience?: string; category?: string };
export type ProfileCorrection = { ok: true; profile: BusinessProfile } | { ok: false; field: OwnerProfileField; reason: "required" | "refused" | "too_long" };

/**
 * The owner's correction on /app/gegevens (FE-03). The business is the one the caller got from the session,
 * never a field of the form. The event holds modes only: no free text (compliance C-07).
 */
export async function correctProfile(db: Db, business: Pick<BusinessRecord, "id" | "profileAuto" | "profileOwner">, fields: ProfileFormFields): Promise<ProfileCorrection> {
  const before = effectiveProfile(business);
  const parsed = parseOwnerProfile({ mode: fields.mode ?? "", offer: fields.offer ?? "", audience: fields.audience ?? "", category: fields.category ?? "" }, before);
  if (!parsed.ok) return parsed;
  await db.setOwnerProfile(business.id, parsed.profile);
  await db.logEvent(business.id, "profile.corrected", { from: before?.mode ?? null, to: parsed.profile.mode });
  return parsed;
}

const FIELDS: OwnerProfileField[] = ["mode", "offer", "audience", "category"];
const REASONS = ["required", "refused", "too_long"] as const;

/** `?profielfout=offer:refused` to a known pair, or null. The query value itself is never shown (security S-25). */
export function parseProfileError(raw: string | undefined): { field: OwnerProfileField; reason: (typeof REASONS)[number] } | null {
  const [f, r] = (raw ?? "").split(":");
  const field = FIELDS.find((x) => x === f);
  const reason = REASONS.find((x) => x === r);
  return field && reason ? { field, reason } : null;
}
