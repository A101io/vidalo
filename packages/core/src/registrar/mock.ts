/**
 * The registrar without a network: VIDALO_MOCK=1, tests and the mail lab.
 * A name is taken when its label contains "bezet" or "taken", or when it was
 * registered here before; "weiger" in the label makes register() refuse, so
 * the refusal path can be shown on the page and in tests.
 */
import { parseDomain } from "./names.js";
import { RegistrarRefused, type Availability, type Holder, type Registered, type Registrar } from "./types.js";

const YEAR = 365 * 24 * 60 * 60 * 1000;

export class MockRegistrar implements Registrar {
  readonly name = "mock" as const;
  readonly domains = new Map<string, { holder: string; autoRenew: boolean; cnames: Map<string, string>; expiresAt: string }>();
  readonly holders = new Map<string, Holder>();
  /** set by tests: the next N calls to register() throw a transient error */
  failNext = 0;

  async check(names: string[]): Promise<Availability[]> {
    return names.map((n) => {
      const p = parseDomain(n);
      if (!p) return { name: n, available: false, reason: "invalid" };
      if (/bezet|taken/.test(p.label) || this.domains.has(p.name)) return { name: p.name, available: false, reason: "taken" };
      return { name: p.name, available: true };
    });
  }

  async ensureHolder(holder: Holder): Promise<string> {
    const handle = `MOCK-${holder.email.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12)}`;
    this.holders.set(handle, holder);
    return handle;
  }

  /** set by tests: register() stores the domain and then throws, as when the answer gets lost */
  loseNextAnswer = false;

  async find(name: string): Promise<Registered | null> {
    const d = this.domains.get(name);
    return d ? { id: `mock-${name}`, expiresAt: d.expiresAt } : null;
  }

  async register(name: string, holderHandle: string): Promise<Registered> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("mock registrar: temporarily unavailable");
    }
    const p = parseDomain(name);
    if (!p || /weiger/.test(p.label)) throw new RegistrarRefused(`mock registrar refuses ${name}`, "refused");
    if ((await this.check([p.name]))[0]!.available === false) throw new RegistrarRefused(`${name} is taken`, "taken");
    const expiresAt = new Date(Date.now() + YEAR).toISOString();
    this.domains.set(p.name, { holder: holderHandle, autoRenew: true, cnames: new Map(), expiresAt });
    if (this.loseNextAnswer) {
      this.loseNextAnswer = false;
      throw new Error("mock registrar: answer lost after registering");
    }
    return { id: `mock-${p.name}`, expiresAt };
  }

  /** The web app and the worker are separate processes in mock mode: a name registered by the other is taken as known. */
  private get(name: string) {
    let d = this.domains.get(name);
    if (!d) this.domains.set(name, (d = { holder: "MOCK", autoRenew: true, cnames: new Map(), expiresAt: new Date(Date.now() + YEAR).toISOString() }));
    return d;
  }

  async pointCname(name: string, host: string, target: string): Promise<void> {
    this.get(name).cnames.set(host, target);
  }

  async authCode(name: string): Promise<string> {
    this.get(name);
    return `MOCK-${name.replace(/\W/g, "").toUpperCase().slice(0, 8)}-TOKEN`;
  }

  async setAutoRenew(name: string, on: boolean): Promise<void> {
    this.get(name).autoRenew = on;
  }
}
