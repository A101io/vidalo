/**
 * Which mails an owner gets. Every mail to the owner goes through
 * `deliver()` in reporter/index.ts, which asks `mailAllowed` first; that is
 * the one place preferences are enforced.
 *
 * Required mails cannot be switched off: they carry the service the owner
 * pays for or asked for, or something only the owner can do. Optional mails
 * can, per group. Unsubscribing (the link in the follow-ups) switches every
 * optional group off at once. A kind that is not listed as optional is
 * required, so a new service mail never gets lost by default; a new
 * commercial mail must be added to OPTIONAL_MAIL_KINDS.
 *
 * Mails to third parties (directory corrections, correction requests and
 * their follow-ups) are letters on the owner's behalf, not mail to the owner,
 * and never pass through here.
 */
import type { Db } from "../db/types.js";

/** Optional groups, as stored in business.mail_prefs (absent = on). */
export const MAIL_PREF_KEYS = ["report", "resolution", "reminder", "followup"] as const;
export type MailPrefKey = (typeof MAIL_PREF_KEYS)[number];
export type MailPrefs = Partial<Record<MailPrefKey, boolean>>;

/** Owner mail kind (the `type`/`kind` tag) -> its optional group. */
export const OPTIONAL_MAIL_KINDS: Record<string, MailPrefKey> = {
  report: "report",
  resolution: "resolution",
  owner_reminder: "reminder",
  followup_7: "followup",
  followup_21: "followup",
};

/** Owner mails that always go: welcome, baseline, site_instruction, owner_instruction, unfixable (and anything not optional). */
export const REQUIRED_MAIL_KINDS = ["welcome", "baseline", "site_instruction", "owner_instruction", "unfixable"] as const;

export function mailAllowed(prefs: MailPrefs | null | undefined, kind: string): boolean {
  const key = OPTIONAL_MAIL_KINDS[kind];
  if (!key) return true;
  return prefs?.[key] !== false;
}

/** Keeps only known keys with boolean values. */
export function normalizeMailPrefs(raw: unknown): MailPrefs {
  const out: MailPrefs = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of MAIL_PREF_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** Every optional group off: what the unsubscribe link does. */
export function allOptionalOff(): MailPrefs {
  return Object.fromEntries(MAIL_PREF_KEYS.map((k) => [k, false])) as MailPrefs;
}

export async function setMailPrefs(db: Db, businessId: string, prefs: MailPrefs): Promise<void> {
  const b = await db.getBusiness(businessId);
  if (!b) return;
  await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, mailPrefs: normalizeMailPrefs(prefs) });
}
