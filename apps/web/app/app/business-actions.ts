"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isMember } from "@vidalo/core/db";
import { safeNext } from "@vidalo/core/shared";
import { ready } from "@/lib/core";
import { env } from "@/lib/env";
import { getI18n } from "@/lib/i18n";
import { getSession } from "@/lib/session";
import { ACTIVE_BUSINESS_COOKIE, ACTIVE_BUSINESS_MAX_AGE } from "@/lib/active-business";

/** Pages that belong to one business's row: after a switch there is nothing there, so go to the dashboard. */
const ROW_PAGES = /^\/app\/(fouten|vermeldingen)\//;

/**
 * The business switcher. `business` is checked with isMember before the cookie is written; a business of
 * another login, an unknown id or a malformed one leaves the cookie as it was and goes to /app (SEC-03).
 * `next` goes through safeNext, so it can only be a path on this site.
 */
export async function chooseBusiness(form: FormData): Promise<void> {
  const { href } = await getI18n();
  const session = await getSession();
  if (!session) redirect(href("/inloggen?next=%2Fapp"));
  const business = String(form.get("business") ?? "");
  if (!(await isMember(await ready(), session.userId, business))) redirect(href("/app"));
  (await cookies()).set(ACTIVE_BUSINESS_COOKIE, business, {
    httpOnly: true,
    secure: env.baseUrl.startsWith("https:"),
    sameSite: "lax",
    path: "/",
    maxAge: ACTIVE_BUSINESS_MAX_AGE,
  });
  let target = safeNext(String(form.get("next") ?? ""));
  if (ROW_PAGES.test(target)) target = "/app";
  // The new page announces the switch (role="status", see SwitchStatus); the flag goes before any #fragment.
  const [path, hash = ""] = target.split("#");
  redirect(href(`${path}${path!.includes("?") ? "&" : "?"}gewisseld=1${hash ? `#${hash}` : ""}`));
}
