/**
 * The customer mail as blocks, rendered twice from the same source: the
 * branded HTML (design G, docs/DESIGN_G.md) and the plain text. A mail is a
 * short summary with one blue button; the full picture lives in the account
 * (/app) or, before someone pays, on their report page (/r/...).
 *
 * Rules carried over from docs/MESSAGING.md: one primary button, counts and
 * dots, never a score; calm verbs, no exclamation marks, no countdowns or
 * scarcity. "Wat er nu gebeurt" shows real next dates, not urgency.
 */
import type { Stip } from "../types.js";
import { copy } from "../copy/index.js";

export const BRAND = {
  ink: "#111827",
  ink2: "#374151",
  muted: "#666d7b",
  line: "#e7e3dc",
  panel: "#f4f1ec",
  blue: "#2563eb",
  font: "'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  stip: { rood: "#d41b44", oranje: "#f59e0b", groen: "#2b7a53", grijs: "#9ca3af" } as Record<Stip, string>,
};

export type Block =
  | { kind: "p"; text: string }
  /** a row of counts: "9" "klopten niet" */
  | { kind: "stats"; items: { value: string; label: string }[] }
  /** bordered cards, the first line bold: examples, before/after, steps to take */
  | { kind: "cards"; title?: string; items: { title: string; lines: string[]; tone?: Stip }[] }
  /** the one primary button */
  | { kind: "cta"; label: string; url: string; note?: string }
  /** what happens next, with dates; done steps get a green dot */
  | { kind: "steps"; title: string; items: { when: string; what: string; done?: boolean }[] }
  /** small grey text */
  | { kind: "note"; text: string };

export interface MailDoc {
  subject: string;
  /** the inbox preview line; without it Gmail shows the wordmark first */
  preheader: string;
  headline: string;
  stip?: Stip;
  /** the sentence next to the dot */
  stipText?: string;
  blocks: Block[];
  unsubscribeUrl?: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function linkify(s: string): string {
  return esc(s).replace(/(https?:\/\/[^\s)<]+)/g, `<a href="$1" style="color:${BRAND.blue};text-decoration:underline;word-break:break-all">$1</a>`);
}

const dot = (colour: string, size = 10) =>
  `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:999px;background:${colour};vertical-align:0"></span>`;

function blockHtml(b: Block): string {
  const p = (inner: string, extra = "") => `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${BRAND.ink2}${extra}">${inner}</p>`;
  switch (b.kind) {
    case "p":
      return p(b.text.split("\n").map(linkify).join("<br>"));
    case "note":
      return `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:${BRAND.muted}">${b.text.split("\n").map(linkify).join("<br>")}</p>`;
    case "stats":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border:1.5px solid ${BRAND.line};border-radius:12px"><tr>${b.items
        .map(
          (s, i) =>
            `<td style="padding:14px 16px;${i ? `border-left:1.5px solid ${BRAND.line};` : ""}vertical-align:top"><div style="font-size:28px;line-height:1.1;font-weight:800;color:${BRAND.ink}">${esc(s.value)}</div><div style="margin-top:4px;font-size:13px;line-height:1.35;color:${BRAND.muted}">${esc(s.label)}</div></td>`,
        )
        .join("")}</tr></table>`;
    case "cards":
      return `${b.title ? `<p style="margin:8px 0 10px;font-size:17px;font-weight:700;color:${BRAND.ink}">${esc(b.title)}</p>` : ""}${b.items
        .map(
          (c) =>
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;border:1.5px solid ${BRAND.line};border-radius:12px"><tr><td style="padding:14px 16px;font-size:15px;line-height:1.5;color:${BRAND.ink2}"><div style="margin:0 0 4px;font-weight:700;color:${BRAND.ink}">${c.tone ? `${dot(BRAND.stip[c.tone])}&nbsp;&nbsp;` : ""}${linkify(c.title)}</div>${c.lines.map((l) => `<div>${linkify(l)}</div>`).join("")}</td></tr></table>`,
        )
        .join("")}`;
    case "cta":
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 ${b.note ? "8px" : "24px"}"><tr><td style="border-radius:10px;background:${BRAND.blue}"><a href="${esc(b.url)}" style="display:inline-block;padding:14px 22px;font-size:16px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:10px">${esc(b.label)}</a></td></tr></table>${
        b.note ? `<p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:${BRAND.muted}">${linkify(b.note)}</p>` : ""
      }`;
    case "steps":
      return `<p style="margin:8px 0 10px;font-size:17px;font-weight:700;color:${BRAND.ink}">${esc(b.title)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">${b.items
        .map(
          (s) =>
            `<tr><td width="22" style="padding:6px 0;vertical-align:top">${s.done ? dot(BRAND.stip.groen) : `<span style="display:inline-block;width:6px;height:6px;border-radius:999px;border:2px solid ${BRAND.muted};vertical-align:1px"></span>`}</td><td style="padding:3px 0;font-size:15px;line-height:1.5;color:${BRAND.ink2}"><strong style="color:${BRAND.ink}">${esc(s.when)}</strong> &nbsp;${linkify(s.what)}</td></tr>`,
        )
        .join("")}</table>`;
  }
}

function blockText(b: Block): string {
  switch (b.kind) {
    case "p":
    case "note":
      return b.text;
    case "stats":
      return b.items.map((s) => `${s.value} ${s.label}`).join(" · ");
    case "cards":
      return [b.title, ...b.items.map((c) => [c.title, ...c.lines].join("\n"))].filter(Boolean).join("\n\n");
    case "cta":
      return [`${b.label}: ${b.url}`, b.note].filter(Boolean).join("\n");
    case "steps":
      return `${b.title}\n${b.items.map((s) => `- ${s.when}: ${s.what}`).join("\n")}`;
  }
}

export function renderMail(d: MailDoc): { subject: string; text: string; html: string } {
  const stipLine = d.stip ? `Stip: ${copy.stip[d.stip].toLowerCase()}. ${d.stipText ?? ""}`.trim() : "";
  const text = [
    "Hoi,",
    d.headline,
    stipLine,
    ...d.blocks.map(blockText),
    "Groet,\nVidalo",
    d.unsubscribeUrl ? `Geen mails meer hierover? Afmelden: ${d.unsubscribeUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .concat("\n");

  const mark = `<span style="display:inline-block;width:17px;height:17px;background:${BRAND.blue};border-radius:999px 999px 999px 2px;vertical-align:-1px;margin-right:6px"></span>`;
  // Hidden preview text, padded so the client does not pull body text in after it.
  const preheader = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff">${esc(d.preheader)}${"&#8199;&#65279;&#847;".repeat(40)}</div>`;
  const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(d.subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:${BRAND.font}">${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff"><tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:${BRAND.font}">
<tr><td data-brand="vidalo" style="padding:0 0 20px;border-bottom:1.5px solid ${BRAND.line}"><span style="font-size:22px;line-height:1;font-weight:800;letter-spacing:-0.02em;color:${BRAND.ink}">${mark}vidalo</span></td></tr>
<tr><td style="padding:28px 0 8px">
<p style="margin:0 0 8px;font-size:16px;line-height:1.55;color:${BRAND.ink2}">Hoi,</p>
<h1 style="margin:0 0 ${d.stip ? "10px" : "20px"};font-size:24px;line-height:1.25;font-weight:800;letter-spacing:-0.01em;color:${BRAND.ink}">${esc(d.headline)}</h1>
${d.stip ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:${BRAND.ink2}">${dot(BRAND.stip[d.stip])}&nbsp;&nbsp;${esc(stipLine)}</p>` : ""}
${d.blocks.map(blockHtml).join("\n")}
<p style="margin:8px 0 16px;font-size:16px;line-height:1.55;color:${BRAND.ink2}">Groet,<br>Vidalo</p></td></tr>
<tr><td style="padding:16px 0 0;border-top:1.5px solid ${BRAND.line};font-size:13px;line-height:1.5;color:${BRAND.muted}">${esc(copy.landing.footer.legal)}${
    d.unsubscribeUrl ? `<br>Geen mails meer hierover? <a href="${esc(d.unsubscribeUrl)}" style="color:${BRAND.muted};text-decoration:underline">Afmelden</a>` : ""
  }</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: d.subject, text, html };
}
