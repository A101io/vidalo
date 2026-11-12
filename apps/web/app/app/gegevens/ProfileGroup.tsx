import type { BusinessProfile, ProfileMode } from "@vidalo/core/types";
import { copyFor, type Lang } from "@vidalo/core/copy";
import { SLOT_LIMIT } from "@vidalo/core/prompts";
import { parseProfileError } from "@vidalo/core/shared";
import { saveProfile } from "./actions";

const MODES: ProfileMode[] = ["door", "visit", "online"];

function when(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });
}

/**
 * "Zo lezen wij je bedrijf" (feature 001, FE-03): what the checks think the business is, where that came from, and the
 * owner's correction. Its own form beside the facts form, so the view keeps one primary button (the facts form's);
 * the save here is the secondary button. Every value is rendered as React text.
 */
export function ProfileGroup({ profile, businessId, lang, saved, error }: { profile: BusinessProfile | null; businessId: string; lang: Lang; saved: boolean; error: string | undefined }) {
  const K = copyFor(lang).facts.profile;
  const err = parseProfileError(error);
  const msg = (field: "mode" | "offer" | "audience" | "category"): string | null => {
    if (!err || err.field !== field) return null;
    if (err.reason === "required") return K.errors.required[field];
    if (err.reason === "too_long" && field !== "mode") return K.errors.tooLong(SLOT_LIMIT[field]);
    return field === "mode" ? K.errors.refused.mode : K.errors.refused.other;
  };
  const source = !profile
    ? K.sourceNone
    : profile.source === "owner"
      ? K.sourceOwner(when(profile.decidedAt, lang))
      : profile.source === "fallback"
        ? K.sourceFallback(when(profile.decidedAt, lang))
        : K.sourceAuto(when(profile.decidedAt, lang));
  const text = [
    { name: "profileOffer", field: "offer" as const, label: K.offer, hint: K.offerHint, value: profile?.offer ?? "", max: SLOT_LIMIT.offer },
    { name: "profileAudience", field: "audience" as const, label: K.audience, hint: K.audienceHint, value: profile?.audience ?? "", max: SLOT_LIMIT.audience },
    { name: "profileCategory", field: "category" as const, label: K.category, hint: K.categoryHint, value: profile?.category ?? "", max: SLOT_LIMIT.category },
  ];
  const modeMsg = msg("mode");
  return (
    <section id="profiel" aria-labelledby="profiel-h" className="card scroll-mt-24 p-5 sm:p-6">
      <h2 id="profiel-h" className="h3">{K.title}</h2>
      <p className="mt-2 text-[15px] text-ink-2">{K.intro}</p>
      <div role="status" aria-live="polite">
        {saved && !err && <p className="mt-3 rounded-xl bg-groen-bg px-4 py-3 text-[15px] text-groen-ink">{K.saved}</p>}
        {err && <p className="mt-3 text-[15px] font-semibold text-rood">{K.errorTitle}. {msg(err.field)}</p>}
      </div>
      <p className="mt-3 text-[14px] text-muted">{source}</p>
      <form action={saveProfile} noValidate className="mt-4 space-y-4">
        <input type="hidden" name="business" value={businessId} />
        <fieldset aria-describedby={modeMsg ? "profile-err-mode" : undefined}>
          <legend className="field-label">{K.modeLegend}</legend>
          <div className="space-y-2">
            {MODES.map((m) => (
              <label key={m} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[10px] border-[1.5px] border-line bg-white px-3 py-2.5 has-[:checked]:border-ink has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-blue/20">
                <input type="radio" name="profileMode" value={m} defaultChecked={profile?.mode === m} required aria-invalid={modeMsg ? true : undefined} className="mt-1 h-4 w-4 accent-blue" autoFocus={err?.field === "mode" && m === MODES[0]} />
                <span>
                  <span className="block text-[15px] font-semibold">{K.modes[m].label}</span>
                  <span className="block text-[13px] text-muted">{K.modes[m].hint}</span>
                </span>
              </label>
            ))}
          </div>
          {modeMsg && <p id="profile-err-mode" className="mt-1.5 text-[14px] text-rood">{modeMsg}</p>}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          {text.map((t) => {
            const m = msg(t.field);
            const describedBy = [m ? `profile-err-${t.field}` : null, `profile-hint-${t.field}`].filter(Boolean).join(" ");
            return (
              <div key={t.name} className={t.field === "offer" ? "sm:col-span-2" : undefined}>
                <label htmlFor={t.name} className="field-label">{t.label}</label>
                <input id={t.name} name={t.name} type="text" required maxLength={t.max} defaultValue={t.value} aria-invalid={m ? true : undefined} aria-describedby={describedBy} autoFocus={err?.field === t.field} className={`field-sm ${m ? "!border-rood" : ""}`} />
                <p id={`profile-hint-${t.field}`} className="mt-1.5 text-[13px] text-muted">{t.hint}</p>
                {m && <p id={`profile-err-${t.field}`} className="mt-1 text-[14px] text-rood">{m}</p>}
              </div>
            );
          })}
        </div>
        <button type="submit" className="btn-sm">{K.submit}</button>
      </form>
    </section>
  );
}
