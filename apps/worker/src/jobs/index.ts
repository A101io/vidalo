import type { Job } from "@vidalo/core/db";
import { email, fixes, followup, indexCheck, operatorTask, publish, recheck, report, sitecheck, sync } from "./misc.js";
import { scan } from "./scan.js";
import { setup } from "./setup.js";
import { paidOnlyBlock } from "./paid.js";
import type { Handler, JobKind, JobPayloads } from "./types.js";

export * from "./types.js";

type AnyHandler = (payload: unknown, job: Job) => Promise<Record<string, unknown> | void>;

const handlers: { [K in JobKind]: Handler<K> } = {
  scan,
  setup,
  publish,
  sync,
  fixes,
  fix: fixes as unknown as Handler<"fix">,
  recheck,
  email,
  report,
  followup,
  operator_task: operatorTask,
  sitecheck,
  index_check: indexCheck,
};

export function handlerFor(kind: string): AnyHandler | null {
  const h = (handlers as Record<string, AnyHandler | undefined>)[kind];
  if (!h) return null;
  return async (payload, job) => {
    const blocked = await paidOnlyBlock(kind as JobKind, (payload ?? {}) as Record<string, unknown>);
    if (blocked) return { skipped: blocked };
    return h(payload, job);
  };
}

export function validatePayload(kind: JobKind, payload: Record<string, unknown>): string | null {
  const need = (keys: string[]) => keys.find((k) => payload[k] === undefined || payload[k] === null) ?? null;
  const missing = (() => {
    switch (kind) {
      case "scan":
        return need(["businessId", "kind"]);
      case "setup":
      case "publish":
      case "sync":
      case "report":
      case "sitecheck":
      case "index_check":
        return need(["businessId"]);
      case "fixes":
      case "fix":
        return need(["scanRunId"]);
      case "recheck":
        return need(["fixId"]);
      case "followup":
        return need(["businessId", "day"]);
      case "email":
        return payload.template ? null : need(["to", "subject", "text"]);
      case "operator_task":
        return need(["reason"]);
      default:
        return null;
    }
  })();
  return missing ? `payload.${missing} is required for ${kind}` : null;
}

export type { JobPayloads };
