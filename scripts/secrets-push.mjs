#!/usr/bin/env node
/**
 * Push secrets from the root .env to the Workers, by name, without printing
 * a value (Control Room A10, secrets.manifest.json).
 *
 *   pnpm secrets:push                      plan: what is set locally, what each Worker holds, what would be pushed
 *   pnpm secrets:push --apply              push every planned secret
 *   pnpm secrets:push --apply --only A,B   push only these names
 *   --allow-spending                       include keys marked "spends" (AI, Places): off by default
 *   --live                                 allow a live Stripe key (sk_live_); off by default
 *   --env <file>                           another .env than the root one (e.g. from a worktree)
 *
 * How a value travels: read from .env into this process, written to
 * `wrangler secret put`'s stdin. Never in argv (visible in `ps`), never in a
 * log, never in the shell history. Child output is scrubbed of every value
 * before it is shown. The plan reads only names from Cloudflare.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const allowSpending = args.includes("--allow-spending");
const live = args.includes("--live");
const onlyIdx = args.indexOf("--only");
const envIdx = args.indexOf("--env");
const envFile = envIdx >= 0 ? path.resolve(args[envIdx + 1]) : path.join(root, ".env");
const only = onlyIdx >= 0 ? new Set(String(args[onlyIdx + 1] ?? "").split(",").filter(Boolean)) : null;

const manifest = JSON.parse(readFileSync(path.join(root, "secrets.manifest.json"), "utf8"));
let env;
try {
  env = parseEnv(readFileSync(envFile, "utf8"));
} catch {
  console.error("No root .env. Nothing to push.");
  process.exit(2);
}
const values = Object.values(env).filter((v) => typeof v === "string" && v.length >= 6);
const scrub = (s) => values.reduce((out, v) => out.split(v).join("[redacted]"), String(s));

const wrangler = (argv, input) =>
  spawnSync("pnpm", ["exec", "wrangler", ...argv], { cwd: path.join(root, "apps/web"), input, encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0" } });

function namesOn(worker) {
  const r = wrangler(["secret", "list", "--name", worker, "--format", "json"]);
  if (r.status !== 0) return null;
  try {
    return new Set(JSON.parse(r.stdout).map((s) => s.name));
  } catch {
    return null;
  }
}

/** Why a value may not go to production, or null. */
function refusal(entry, value) {
  if (entry.spends && !allowSpending) return "spends money: add --allow-spending";
  if (entry.requirePrefix && !value.startsWith(entry.requirePrefix)) return `does not start with ${entry.requirePrefix}`;
  if (entry.liveOnlyWith && value.startsWith("sk_live_") && !live) return "live Stripe key: add --live";
  for (const re of entry.forbidInProduction ?? []) if (new RegExp(re).test(value)) return "a test value that must not reach production";
  return null;
}

const held = new Map(Object.entries(manifest.workers).map(([k, w]) => [k, namesOn(w)]));
const plan = [];
console.log(`${apply ? "Pushing" : "Plan (add --apply to push)"} — values are never shown\n`);
for (const entry of manifest.secrets) {
  if (only && !only.has(entry.name)) continue;
  const value = env[entry.name]?.trim();
  const local = value ? "set" : "missing";
  if (!entry.targets.length) {
    console.log(`  ${entry.name.padEnd(30)} .env ${local.padEnd(8)} local only`);
    continue;
  }
  for (const t of entry.targets) {
    const worker = manifest.workers[t];
    const there = held.get(t)?.has(entry.name) ? "on worker" : "not on worker";
    const why = value ? refusal(entry, value) : "not in .env";
    console.log(`  ${entry.name.padEnd(30)} .env ${local.padEnd(8)} ${worker.padEnd(14)} ${there.padEnd(14)} ${why ? `hold: ${why}` : "push"}`);
    if (!why) plan.push({ name: entry.name, worker, value });
  }
}

if (!apply) {
  console.log(`\n${plan.length} to push. Source of each missing key: secrets.manifest.json → "source".`);
  process.exit(0);
}
let failed = 0;
for (const p of plan) {
  const r = wrangler(["secret", "put", p.name, "--name", p.worker], p.value);
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${p.name} → ${p.worker}${ok ? "" : `: ${scrub(r.stderr || r.stdout).split("\n").filter(Boolean).slice(-2).join(" ")}`}`);
}
// Read back by name: the proof that it landed, without the value.
for (const w of Object.values(manifest.workers)) {
  const now = namesOn(w);
  const want = plan.filter((p) => p.worker === w).map((p) => p.name);
  const missing = want.filter((n) => !now?.has(n));
  console.log(`  ${w}: ${want.length - missing.length}/${want.length} read back${missing.length ? `, missing ${missing.join(", ")}` : ""}`);
}
process.exit(failed ? 1 : 0);
