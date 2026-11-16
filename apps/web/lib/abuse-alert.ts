import { env } from "@/lib/env";
import { ready } from "@/lib/db";
import { sendMail } from "@vidalo/core/reporter";
import { dayStart, log } from "@vidalo/core/shared";

/**
 * A site-wide brake on free checks was hit (the daily count, the daily euro ceiling, the
 * confirmation-mail backstop). That is either a busy day or someone working through the
 * free check, and nobody noticed before (11 Nov 2026). Logged every time it refuses; once per
 * brake per UTC day an event and, when VIDALO_ALERT_EMAIL is set, a short mail to Vidalo.
 * Never throws: a failed alert must not turn a refusal into an error page.
 */
const WHAT: Record<string, string> = {
  daily_cap: "Het dagplafond voor gratis controles (FREE_SCANS_PER_DAY) is bereikt.",
  spend_cap: "Het plafond in euro's voor gratis controles (FREE_AI_CAP_CENTS) is bereikt.",
  confirm_mail_cap: "De noodrem op bevestigingsmails voor de hele site is bereikt.",
};

export async function alertOnce(brake: string, detail: Record<string, unknown>): Promise<void> {
  try {
    log.warn("free_check.brake", { brake, ...detail });
    const db = await ready();
    const type = `alert.free_check.${brake}`;
    // No lock on purpose: this runs inside FREE_CHECK_LOCK, and a nested lock would hold a second of the three
    // connections a Worker request has. The price is a rare duplicate mail when refusals race (security P3).
    if ((await db.countEventsSince(type, dayStart())) > 0) return;
    await db.logEvent(null, type, detail);
    if (!env.alertEmail) return;
    const lines = [
      WHAT[brake] ?? `Noodrem ${brake} is bereikt.`,
      "",
      ...Object.entries(detail).map(([k, v]) => `${k}: ${String(v)}`),
      "",
      "Nieuwe gratis controles wachten tot er weer ruimte is: het dagplafond telt de laatste 24 uur, het plafond in euro's de dag in UTC. Is dit een aanval, zet dan FREE_SCANS_PER_DAY op 0 (docs/RUNBOOK.md). Is het gewoon druk, verhoog dan het plafond.",
      "Je krijgt deze mail hooguit één keer per dag per noodrem.",
    ];
    await sendMail({ to: env.alertEmail, subject: `Vidalo: noodrem gratis controle (${brake})`, text: lines.join("\n"), tags: { kind: "ops_alert" } });
  } catch (err) {
    log.warn("free_check.alert_failed", { brake, error: err instanceof Error ? err.message : String(err) });
  }
}
