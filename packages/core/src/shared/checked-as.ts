/**
 * "Gecontroleerd als: …": how Vidalo read the business, in the words the report page uses
 * (copy.result.checkedAs). One function for the report, the CLI summary and the mails, so they
 * word the profile the same way. It is Vidalo's reading, never a statement about the business
 * (compliance C-20); a fallback reading names the kind of business only (B4).
 */
import type { ProfileSummary } from "../types.js";
import type { CopyShape } from "../copy/index.js";

export function checkedAsParts(profile: ProfileSummary | null | undefined, C: CopyShape["result"]["checkedAs"]): { line: string; how: string } | null {
  if (!profile) return null;
  const described = profile.source === "fallback" ? null : (profile.category ?? profile.offer);
  const what = described ? [described, profile.audience && profile.category ? C.forAudience(profile.audience) : null].filter(Boolean).join(" ") + `, ${C.mode[profile.mode]}` : C.modeOnly[profile.mode];
  return { line: C.line(what), how: C.how[profile.source] };
}
