/**
 * The registrar in use. Mock in VIDALO_MOCK=1 (and in tests, via
 * setRegistrar); Openprovider when its credentials are set; otherwise none,
 * and option B on /app/domein says it is not available rather than taking
 * money for a domain nobody can register.
 */
import { MockRegistrar } from "./mock.js";
import { OpenproviderRegistrar, openproviderConfig } from "./openprovider.js";
import type { Registrar } from "./types.js";

const g = globalThis as typeof globalThis & { __vidaloRegistrar?: Registrar | null; __vidaloMockRegistrar?: MockRegistrar };

/** Tests and the mail lab put their own in; null goes back to the environment's choice. */
export function setRegistrar(r: Registrar | null): void {
  g.__vidaloRegistrar = r;
}

export function getRegistrar(): Registrar | null {
  if (g.__vidaloRegistrar) return g.__vidaloRegistrar;
  if (process.env.VIDALO_MOCK === "1") return (g.__vidaloMockRegistrar ??= new MockRegistrar());
  const cfg = openproviderConfig();
  return cfg ? new OpenproviderRegistrar(cfg) : null;
}
