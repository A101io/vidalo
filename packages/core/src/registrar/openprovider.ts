/**
 * Openprovider (docs/DOMAINS.md): REST/JSON at https://api.openprovider.eu/v1,
 * a Bearer token from POST /auth/login (username + password of an API contact
 * person, valid 48 hours, no IP allowlist when the list is left empty). Plain
 * fetch, so it runs on Cloudflare Workers.
 *
 * Roles on a domain: the owner's business is the holder (owner_handle) and
 * the administrative contact, as SIDN asks; Vidalo's own handle
 * (OPENPROVIDER_TECH_HANDLE) is the technical and billing contact. DNS is
 * Openprovider's (ns_group "dns-openprovider"), with one record: feiten → Vidalo.
 *
 * Errors: an answer in the 4xx range other than 401/408/429 is a refusal
 * (RegistrarRefused); a 5xx, a timeout or a network error is thrown as is,
 * so the job retries.
 */
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { parseDomain } from "./names.js";
import { RegistrarRefused, type Availability, type Holder, type Registered, type Registrar } from "./types.js";

export interface OpenproviderConfig {
  baseUrl: string;
  username: string;
  password: string;
  /** Vidalo's own contact handle at Openprovider: technical and billing contact on every domain */
  techHandle: string;
}

export function openproviderConfig(): OpenproviderConfig | null {
  const username = process.env.OPENPROVIDER_USERNAME;
  const password = process.env.OPENPROVIDER_PASSWORD;
  const techHandle = process.env.OPENPROVIDER_TECH_HANDLE;
  if (!username || !password || !techHandle) return null;
  return { baseUrl: (process.env.OPENPROVIDER_API_URL || "https://api.openprovider.eu/v1").replace(/\/$/, ""), username, password, techHandle };
}

interface Envelope<T> {
  code: number;
  desc?: string;
  data: T;
}

const TOKEN_TTL = 24 * 60 * 60 * 1000; // Openprovider gives 48 hours; half is plenty of margin
const tokens = new Map<string, { token: string; until: number }>();

/** "+31 6 12345678" → { country_code: "+31", area_code: "6", subscriber_number: "12345678" } */
export function splitPhone(e164: string, country = "NL"): { country_code: string; area_code: string; subscriber_number: string } {
  const p = parsePhoneNumberFromString(e164, country as never);
  if (!p) throw new RegistrarRefused(`phone number ${e164} cannot be read`, "bad_phone");
  const nat = String(p.nationalNumber);
  // Dutch mobile numbers have a one-digit "area" (6); for the rest two digits is what Openprovider accepts.
  const area = nat.startsWith("6") && p.countryCallingCode === "31" ? 1 : 2;
  return { country_code: `+${p.countryCallingCode}`, area_code: nat.slice(0, area), subscriber_number: nat.slice(area) };
}

export class OpenproviderRegistrar implements Registrar {
  readonly name = "openprovider" as const;
  constructor(private readonly cfg: OpenproviderConfig) {}

  private async token(): Promise<string> {
    const hit = tokens.get(this.cfg.username);
    if (hit && hit.until > Date.now()) return hit.token;
    const r = await this.raw<{ token: string }>("POST", "/auth/login", { username: this.cfg.username, password: this.cfg.password, ip: "0.0.0.0" }, false);
    tokens.set(this.cfg.username, { token: r.token, until: Date.now() + TOKEN_TTL });
    return r.token;
  }

  private async raw<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${await this.token()}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (res.ok && json && json.code === 0) return json.data;
    const what = `openprovider ${method} ${path}: ${res.status} ${json?.code ?? ""} ${json?.desc ?? ""}`.trim();
    if (res.status === 401) tokens.delete(this.cfg.username);
    if (res.status >= 400 && res.status < 500 && ![401, 408, 429].includes(res.status)) throw new RegistrarRefused(what, String(json?.code ?? res.status));
    throw new Error(what);
  }

  private split(name: string): { name: string; extension: string } {
    const p = parseDomain(name);
    if (!p) throw new RegistrarRefused(`${name} is not a name we register`, "invalid");
    return { name: p.label, extension: p.tld };
  }

  private async idOf(name: string): Promise<number> {
    const r = await this.raw<{ results?: { id: number }[] }>("GET", `/domains?full_name=${encodeURIComponent(name)}&limit=1`);
    const id = r.results?.[0]?.id;
    if (!id) throw new RegistrarRefused(`${name} is not in this Openprovider account`, "unknown_domain");
    return id;
  }

  async check(names: string[]): Promise<Availability[]> {
    const valid = names.map((n) => ({ n, p: parseDomain(n) }));
    const ask = valid.filter((v) => v.p).map((v) => ({ name: v.p!.label, extension: v.p!.tld }));
    const r = ask.length ? await this.raw<{ results?: { domain: string; status: string; reason?: string; is_premium?: boolean }[] }>("POST", "/domains/check", { domains: ask }) : { results: [] };
    return valid.map(({ n, p }) => {
      if (!p) return { name: n, available: false, reason: "invalid" };
      const hit = r.results?.find((x) => x.domain.toLowerCase() === p.name);
      // A premium name costs more than our one price: not offered.
      if (hit?.status === "free" && !hit.is_premium) return { name: p.name, available: true };
      return { name: p.name, available: false, reason: hit?.is_premium ? "premium" : (hit?.reason ?? hit?.status ?? "unknown") };
    });
  }

  async ensureHolder(h: Holder): Promise<string> {
    const r = await this.raw<{ handle: string }>("POST", "/customers", {
      company_name: h.company,
      name: { first_name: h.firstName, last_name: h.lastName },
      address: { street: h.street, number: h.houseNumber, zipcode: h.postcode, city: h.city, country: h.country },
      phone: splitPhone(h.phone, h.country),
      email: h.email,
      locale: "nl_NL",
      ...(h.kvk ? { additional_data: { company_registration_number: h.kvk } } : {}),
    });
    return r.handle;
  }

  async register(name: string, holderHandle: string): Promise<Registered> {
    const r = await this.raw<{ id: number; expiration_date?: string; status?: string }>("POST", "/domains", {
      domain: this.split(name),
      period: 1,
      owner_handle: holderHandle,
      admin_handle: holderHandle,
      tech_handle: this.cfg.techHandle,
      billing_handle: this.cfg.techHandle,
      ns_group: "dns-openprovider",
      autorenew: "on",
    });
    // expiration_date comes as "2027-11-09 12:00:00"; without it, a year from now.
    const exp = r.expiration_date ? new Date(`${r.expiration_date.replace(" ", "T")}Z`) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    return { id: String(r.id), expiresAt: exp.toISOString() };
  }

  async pointCname(name: string, host: string, target: string): Promise<void> {
    const record = { name: host.endsWith(`.${name}`) ? host.slice(0, -name.length - 1) : host, type: "CNAME", value: target, ttl: 3600 };
    try {
      await this.raw("POST", "/dns/zones", { domain: this.split(name), type: "master", records: [record] });
    } catch (err) {
      if (!(err instanceof RegistrarRefused)) throw err;
      // The zone exists already (made with the domain, or by an earlier try): replace the record in it.
      await this.raw("PUT", `/dns/zones/${encodeURIComponent(name)}`, { name, records: { replace: [record] } });
    }
  }

  async authCode(name: string): Promise<string> {
    const r = await this.raw<{ auth_code: string }>("GET", `/domains/${await this.idOf(name)}/authcode`);
    return r.auth_code;
  }

  async setAutoRenew(name: string, on: boolean): Promise<void> {
    await this.raw("PUT", `/domains/${await this.idOf(name)}`, { autorenew: on ? "on" : "off" });
  }
}
