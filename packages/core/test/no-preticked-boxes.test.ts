/**
 * No checkbox is ticked for the visitor (feature 003, AC-9, F-005). Reads apps/web as text,
 * like legal.test.ts reads the source tree. Boxes that show a choice the owner already made
 * are allow-listed by file and must bind it to stored state, never to a literal `true`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../..");
const WEB = join(ROOT, "apps/web");

function tsx(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === ".next" || n === ".open-next") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) tsx(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** file (relative to repo root) -> pattern the box's checked/defaultChecked expression must read from */
const STORED_CHOICE: Record<string, RegExp> = {
  "apps/web/app/app/gegevens/FactsForm.tsx": /\bchecked=\{r\.closed\}/, // the owner's own opening hours
  "apps/web/app/app/account/page.tsx": /defaultChecked=\{business\.mailPrefs\[/, // the stored mail preference
};

export function checkboxes(src: string): string[] {
  return src.match(/<input\b[^>]*type="checkbox"[^>]*>/gs) ?? [];
}

export function violations(file: string, src: string): string[] {
  const bad: string[] = [];
  for (const tag of checkboxes(src)) {
    if (!/\b(defaultChecked|checked)\b/.test(tag)) continue;
    const literal = /\b(defaultChecked|checked)(=\{true\})?(?=\s|\/|>)/.test(tag); // bare attribute or ={true}
    const stored = STORED_CHOICE[file]?.test(tag) ?? false;
    if (/name="marketing"/.test(tag) || literal || !stored) bad.push(`${file}: ${tag.slice(0, 90)}`);
  }
  return bad;
}

describe("no pre-ticked checkboxes", () => {
  const files = tsx(WEB).map((p) => [relative(ROOT, p), readFileSync(p, "utf8")] as const);

  it("finds the checkboxes (the scan is not empty)", () => {
    expect(files.reduce((n, [, s]) => n + checkboxes(s).length, 0)).toBeGreaterThanOrEqual(3);
  });

  it("none is ticked unless it renders a stored choice", () => {
    expect(files.flatMap(([f, s]) => violations(f, s))).toEqual([]);
  });

  it("control: a defaultChecked marketing box is caught", () => {
    const f = "apps/web/components/ScanField.tsx";
    expect(violations(f, '<input type="checkbox" name="marketing" value="ja" defaultChecked />').length).toBe(1);
  });

  it("control: a literal tick on an allow-listed file is caught", () => {
    const f = "apps/web/app/app/account/page.tsx";
    expect(violations(f, '<input type="checkbox" name={k} defaultChecked />').length).toBe(1);
    expect(violations(f, '<input type="checkbox" name={k} defaultChecked={true} />').length).toBe(1);
    expect(violations(f, '<input type="checkbox" name={k} defaultChecked={business.mailPrefs[k] !== false} />').length).toBe(0);
  });
});
