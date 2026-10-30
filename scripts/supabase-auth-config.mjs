#!/usr/bin/env node
/**
 * Applies the sign-in e-mail settings to the Supabase project
 * (docs/auth-email/README.md): Site URL, allowed redirect URLs, the mail
 * subject and the Vidalo template for "Magic Link" and "Confirm signup".
 * It does not touch the SMTP settings (sender and Resend key), which are set
 * in the dashboard.
 *
 *   supabase login                       # once; the CLI keeps the token in the keychain
 *   node scripts/supabase-auth-config.mjs            # apply + verify
 *   node scripts/supabase-auth-config.mjs --check    # read back only
 *
 * The token comes from the Supabase CLI's keychain entry or SUPABASE_ACCESS_TOKEN.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REF = "bbynmqvaxpjdnkaasutd"; // Vidalo. Sitty is hlelpndtejajipqwjwrf, Sonable muuijbupsnhascqzfbin.
const API = `https://api.supabase.com/v1/projects/${REF}/config/auth`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = readFileSync(path.join(root, "docs/auth-email/sign-in.html"), "utf8");
const subject = "Je inloglink voor Vidalo · Your Vidalo sign-in link";
const wanted = {
  site_url: "https://vidalo.io",
  uri_allow_list: [
    "https://vidalo.io/**",
    "https://vidalo-web-staging.julian-devriend.workers.dev/**",
    "https://vidalo-web-preview.julian-devriend.workers.dev/**",
    "http://localhost:3000/**",
  ].join(","),
  mailer_subjects_magic_link: subject,
  mailer_subjects_confirmation: subject,
  mailer_templates_magic_link_content: template,
  mailer_templates_confirmation_content: template,
};

function token() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  try {
    return execFileSync("security", ["find-generic-password", "-s", "Supabase CLI", "-w"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("No Supabase token: run `supabase login` first, or set SUPABASE_ACCESS_TOKEN.");
  }
}

async function call(method, body) {
  const res = await fetch(API, { method, headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${res.status}: ${json.message ?? JSON.stringify(json).slice(0, 200)}`);
  return json;
}

function report(cfg) {
  const ok = (name, pass) => console.log(`${pass ? "✓" : "✗"} ${name}`);
  ok(`site_url = ${cfg.site_url}`, cfg.site_url === wanted.site_url);
  ok(`redirect URLs: ${cfg.uri_allow_list}`, cfg.uri_allow_list === wanted.uri_allow_list);
  ok(`subject (magic link) = ${cfg.mailer_subjects_magic_link}`, cfg.mailer_subjects_magic_link === subject);
  ok(`subject (confirm signup) = ${cfg.mailer_subjects_confirmation}`, cfg.mailer_subjects_confirmation === subject);
  ok("template (magic link) is the Vidalo template", cfg.mailer_templates_magic_link_content === template);
  ok("template (confirm signup) is the Vidalo template", cfg.mailer_templates_confirmation_content === template);
  ok(`sender = ${cfg.smtp_sender_name} <${cfg.smtp_admin_email}> via ${cfg.smtp_host}:${cfg.smtp_port}, password set`, cfg.smtp_host === "smtp.resend.com" && cfg.smtp_admin_email === "inloggen@vidalo.io" && Boolean(cfg.smtp_pass));
}

const checkOnly = process.argv.includes("--check");
const cfg = checkOnly ? await call("GET") : await call("PATCH", wanted);
report(cfg);
