/**
 * The website a visitor may type on /scan/kies for a business Google does not list (ADR-0007). It is a
 * visitor-typed address that the server will fetch, so it is checked at the boundary before anything is
 * stored or fetched (security S-12, S-13): a public http(s) address only, at most 200 characters, no
 * credentials, no IP literal, no internal or private host, no port other than the default, no control or
 * markup characters. A missing scheme is added (https), so "javascript:x" becomes the host "javascript" with a bad port and
 * is refused with the other non-hosts. The raw value is never echoed anywhere.
 */
import { isPublicHttpUrl } from "../scanner/util.js";

export const MAX_TYPED_WEBSITE = 200;

export type TypedWebsite = { ok: true; url: string | null } | { ok: false };

const CONTROL = /[\p{Cc}\p{Cf}\s­​-‏⁠-⁤﻿]/u;
/** A scheme with its slashes ("https://"). */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Empty is fine (ok, url null: the check runs without it). Anything else is a clean public https/http origin + path, or refused. */
export function parseTypedWebsite(raw: unknown): TypedWebsite {
  if (raw == null) return { ok: true, url: null };
  if (typeof raw !== "string") return { ok: false };
  const text = raw.trim();
  if (!text) return { ok: true, url: null };
  if (text.length > MAX_TYPED_WEBSITE) return { ok: false };
  if (CONTROL.test(text) || /[<>"'`\\]/.test(text.normalize("NFKC"))) return { ok: false };
  const withScheme = HAS_SCHEME.test(text) ? text : `https://${text}`;
  const u = isPublicHttpUrl(withScheme);
  if (!u) return { ok: false };
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  // A name with a dot, never an address: "8.8.8.8", "[::1]" and "2130706433" are not websites a business has.
  if (!host.includes(".") || host.includes(":") || /^[\d.]+$/.test(host)) return { ok: false };
  if (u.port && u.port !== "80" && u.port !== "443") return { ok: false };
  const path = u.pathname === "/" ? "" : u.pathname;
  const url = `${u.protocol}//${host}${path}`;
  return url.length > MAX_TYPED_WEBSITE ? { ok: false } : { ok: true, url };
}
