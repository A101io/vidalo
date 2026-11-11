/**
 * Business profile helpers (feature 001). BE-01 holds the two pure functions the other lanes
 * import; the understanding step itself (ensureProfile) arrives with BE-04.
 */
import type { BusinessProfile, ProfileMode } from "../types";
import { SLOT_LIMIT, sanitizeSlot } from "../prompts/slots";

const MODES: ProfileMode[] = ["door", "visit", "online"];

/** The owner's mode, offer, audience and category laid over the automatic profile; null when neither exists. */
export function effectiveProfile(b: { profileAuto: BusinessProfile | null; profileOwner: BusinessProfile | null }): BusinessProfile | null {
  const { profileAuto: auto, profileOwner: owner } = b;
  if (!owner) return auto ? { ...auto, competitors: [...auto.competitors], basis: [...auto.basis] } : null;
  const base = auto ?? owner;
  return {
    ...owner,
    competitors: [...base.competitors],
    website: base.website,
    basis: [...owner.basis],
  };
}

export type OwnerProfileField = "mode" | "offer" | "audience" | "category";
export type OwnerProfileResult =
  | { ok: true; profile: BusinessProfile }
  | { ok: false; field: OwnerProfileField; reason: "required" | "refused" | "too_long" };

const TEXT_FIELDS: { field: Exclude<OwnerProfileField, "mode">; slot: "offer" | "audience" | "category" }[] = [
  { field: "offer", slot: "offer" },
  { field: "audience", slot: "audience" },
  { field: "category", slot: "category" },
];

/** Validate the owner's correction form. All four fields are required; the first problem is returned. */
export function parseOwnerProfile(
  fields: { mode: string; offer: string; audience: string; category: string },
  current: BusinessProfile | null,
  now: Date = new Date(),
): OwnerProfileResult {
  const mode = (fields.mode ?? "").trim();
  if (!mode) return { ok: false, field: "mode", reason: "required" };
  if (!(MODES as string[]).includes(mode)) return { ok: false, field: "mode", reason: "refused" };
  const clean: Record<string, string> = {};
  for (const { field, slot } of TEXT_FIELDS) {
    const raw = (fields[field] ?? "").trim();
    if (!raw) return { ok: false, field, reason: "required" };
    if (raw.length > SLOT_LIMIT[slot]) return { ok: false, field, reason: "too_long" };
    const out = sanitizeSlot(raw, slot);
    if (out === null) return { ok: false, field, reason: "refused" };
    clean[field] = out;
  }
  return {
    ok: true,
    profile: {
      mode: mode as ProfileMode,
      offer: clean.offer!,
      audience: clean.audience!,
      category: clean.category!,
      competitors: current ? [...current.competitors] : [],
      website: current?.website ?? null,
      confidence: "high",
      basis: ["owner"],
      source: "owner",
      grounded: true,
      decidedAt: now.toISOString(),
    },
  };
}
