"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ProductLineFieldError, ProductLineFormInput } from "@vidalo/core/shared";
import { ready } from "@/lib/db";
import { getI18n } from "@/lib/i18n";
import { businessFromForm, requireOwnerOf } from "@/lib/owner";
import { saveLineFromForm, setStatusFromForm } from "@/lib/product-lines";

/**
 * What the form gets back when it stays on screen: the errors and what was typed. A server-side error never redirects with
 * the typed values in the URL and never empties the form (WCAG 3.3.7, compliance L-16, L-62). Null before the first submit.
 */
export type LineFormState = { fields?: ProductLineFieldError[]; limit?: boolean; values: ProductLineFormInput } | null;

// Both actions name their business in the form and ask requireOwnerOf FIRST (membership of that business, never the
// cookie). Access (verified owner, paying, monthly plan, not paused, switch on) is then productLineAccess, on the server,
// for every write: hiding the form is not the gate.

/** "Bevestigen en opslaan": a new line, or version n+1 of an existing one. */
export async function saveProductLine(_prev: LineFormState, form: FormData): Promise<LineFormState> {
  const { session, business } = await requireOwnerOf(businessFromForm(form), "/app/productlijnen");
  const outcome = await saveLineFromForm(await ready(), { business, userId: session.userId }, form);
  if ("to" in outcome) {
    revalidatePath("/app/productlijnen", "layout");
    redirect((await getI18n()).href(outcome.to));
  }
  return "limit" in outcome ? { limit: true, values: outcome.values } : { fields: outcome.fields, values: outcome.values };
}

/** "Niet meer leverbaar" / "Weer actief". */
export async function setProductLineStatus(form: FormData): Promise<void> {
  const { session, business } = await requireOwnerOf(businessFromForm(form), "/app/productlijnen");
  const { to } = await setStatusFromForm(await ready(), { business, userId: session.userId }, form);
  revalidatePath("/app/productlijnen", "layout");
  redirect((await getI18n()).href(to));
}
