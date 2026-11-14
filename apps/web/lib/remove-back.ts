/** Where a removal may send you back to: the two pages that list checks. Anything else is the sign-in page. */
export function removeBackTarget(raw: string | null | undefined): "/inloggen" | "/app/rapporten" {
  return raw === "/app/rapporten" ? "/app/rapporten" : "/inloggen";
}
