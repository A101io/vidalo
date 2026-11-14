"use server";

import { redirect } from "next/navigation";
import { getI18n } from "@/lib/i18n";
import { getSession } from "@/lib/session";
import { ready } from "@/lib/db";
import { removeCheck } from "@vidalo/core/db";
import { removeBackTarget } from "@/lib/remove-back";

/**
 * Removes one check, after the confirm page. Who may is decided in core (removeCheck): a check asked for with this
 * login's own address, or a check of a business this login belongs to; nothing the form sends decides that.
 */
export async function removeMyCheck(form: FormData): Promise<void> {
  const { href } = await getI18n();
  const runId = String(form.get("run") ?? "");
  const back = removeBackTarget(String(form.get("back") ?? ""));
  const session = await getSession();
  if (!session) redirect(href(`/inloggen?next=${encodeURIComponent(back)}`));
  const res = await removeCheck(await ready(), { userId: session.userId, email: session.email }, runId);
  if (!res.ok) redirect(href(`${back}?controle=${res.reason}`));
  redirect(href(`${back}?controle=${res.outcome === "removed" ? "weg" : "los"}`));
}
