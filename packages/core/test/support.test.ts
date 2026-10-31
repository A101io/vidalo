import { describe, expect, it } from "vitest";
import { MemDb } from "../src/db/mem.js";
import { copy, copyFor } from "../src/copy/index.js";
import { buildKnowledge } from "../src/chat/index.js";
import {
  RELAY_SECRET_HEADER,
  VIDALO_SUPPORT_CONFIG,
  decideSupportReply,
  handleVidaloSupportRelay,
  scanOutboundReply,
  supportIdentityLine,
  vidaloAccountContext,
  type SupportModelProvider,
} from "../src/support/index.js";

/**
 * The support@vidalo.io responder: Vidalo's configuration of the kit's brain.
 * The kit's own 34 tests are the specification of kit-support.ts; what is
 * tested here is what Vidalo adds — the one knowledge file, the deny list,
 * the account context, the log in MemDb — and that the endpoint fails closed.
 */

const scan = (draft: string) =>
  scanOutboundReply(draft, { senderEmail: "bakker@example.nl" }, {
    allowedLinkHosts: VIDALO_SUPPORT_CONFIG.allowedLinkHosts,
    allowedAddresses: ["support@vidalo.io", "hello@vidalo.io"],
    denyPatterns: VIDALO_SUPPORT_CONFIG.denyPatterns,
  });

describe("support@vidalo.io — what the mail responder knows and refuses", () => {
  it("reads the same knowledge as the website assistant, in both languages, with the prices and the addresses", () => {
    const knowledge = VIDALO_SUPPORT_CONFIG.knowledge as (lang: "nl" | "en") => string;
    expect(knowledge("nl")).toBe(buildKnowledge(copy, "nl"));
    expect(knowledge("en")).toBe(buildKnowledge(copyFor("en"), "en"));
    expect(knowledge("nl")).toContain("€149");
    expect(knowledge("nl")).toContain("support@vidalo.io");
    expect(VIDALO_SUPPORT_CONFIG.responseRules).toContain("Beloof nooit");
    expect(VIDALO_SUPPORT_CONFIG.responseRules).toContain("Never promise");
  });

  it("closes every reply with the statutory line in the reader's language", () => {
    expect(supportIdentityLine("nl")).toContain("KvK 42057858");
    expect(supportIdentityLine("nl")).toContain("support@vidalo.io");
    expect(supportIdentityLine("en")).toContain("A101 B.V.");
  });

  it("refuses a draft that claims Vidalo controls what an AI assistant answers, in either language", () => {
    expect(scan("Vidalo bepaalt wat ChatGPT over je zegt.").violations).toContain("claim_controls_ai");
    expect(scan("We guarantee what Google AI answers about your business.").violations).toContain("claim_controls_ai");
    expect(scan("Vidalo herstelt de bronnen; de AI-assistenten beslissen zelf wat ze antwoorden.").safe).toBe(true);
  });

  it("refuses the banned jargon and the old product name", () => {
    expect(scan("Our GEO service improves your LLM visibility.").violations).toContain("banned_jargon");
    expect(scan("Je koopt credits voor elke prompt.").violations).toContain("banned_jargon");
    expect(scan("Welcome to Maicro.").violations).toContain("claim_wrong_product_name");
  });

  it("lets a reply link to vidalo.io and name the two mailboxes, and nothing else", () => {
    expect(scan("Zie https://vidalo.io/prijzen of mail hello@vidalo.io.").safe).toBe(true);
    expect(scan("Zie https://evil.example.com").violations).toContain("disallowed_link:evil.example.com");
  });
});

describe("support@vidalo.io — the account context and the log", () => {
  it("writes the account line for a business owner, in the owner's language, and nothing for a stranger", async () => {
    const db = new MemDb();
    await db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", ownerUserId: "u1", ownerEmail: "eigenaar@bakkerijdevries.nl", status: "monitoring", language: "en" } as never);
    const ctx = await vidaloAccountContext(db, "eigenaar@bakkerijdevries.nl");
    expect(ctx?.line).toContain("Bakkerij De Vries");
    expect(ctx?.language).toBe("en");
    expect(ctx?.matched?.status).toBe("monitoring");
    expect(await vidaloAccountContext(db, "nobody@example.com")).toBeNull();
  });

  it("counts replies per thread and per sender, and refuses a second row for the same message", async () => {
    const db = new MemDb();
    const row = {
      provider_message_id: "m1",
      provider_thread_id: "t1",
      from_email: "bakker@example.nl",
      subject: "Prijs?",
      body_excerpt: "Wat kost het?",
      action: "replied" as const,
      reason: "answered_plans_and_features",
      topic: "plans_and_features",
      language: "nl" as const,
      platform_related: true,
      flagged_for_human: false,
      reply_subject: "Re: Prijs?",
      reply_body: "…",
      guard_violations: [],
      matched: null,
      model_calls: 2,
    };
    expect(await db.recordSupportAutoreply(row)).toEqual({ duplicate: false });
    expect(await db.recordSupportAutoreply(row)).toEqual({ duplicate: true });
    expect(await db.supportAutoreplyCounters("bakker@example.nl", "t1")).toEqual({ alreadyRepliedInThread: true, decisionsForSenderToday: 1, modelCallsToday: 2 });
    expect(await db.supportAutoreplyCounters("bakker@example.nl", "t2")).toEqual({ alreadyRepliedInThread: false, decisionsForSenderToday: 1, modelCallsToday: 2 });
    expect(await db.supportAutoreplyCounters("other@example.nl", null)).toEqual({ alreadyRepliedInThread: false, decisionsForSenderToday: 0, modelCallsToday: 2 });
    // An escalated row counts toward the sender's day too: every decision does.
    await db.recordSupportAutoreply({ ...row, provider_message_id: "m2", action: "escalated", model_calls: 1 });
    expect(await db.supportAutoreplyCounters("bakker@example.nl", null)).toMatchObject({ decisionsForSenderToday: 2, modelCallsToday: 3 });
  });
});

describe("POST /api/support-autoreply — fails closed", () => {
  const payload = { from: "bakker@example.nl", subject: "Prijs?", body: "Wat kost een controle?", messageId: "m9", threadId: "t9" };
  const post = (secret?: string) =>
    new Request("https://vidalo.io/api/support-autoreply", {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { [RELAY_SECRET_HEADER]: secret } : {}) },
      body: JSON.stringify(payload),
    });

  it("answers 503 while the relay secret is unset, and 401 to a wrong one, without touching the log", async () => {
    const db = new MemDb();
    expect((await handleVidaloSupportRelay(post("x"), db, { secret: undefined, apiKey: undefined })).status).toBe(503);
    expect((await handleVidaloSupportRelay(post("wrong"), db, { secret: "right", apiKey: undefined })).status).toBe(401);
    expect(db.supportLog).toHaveLength(0);
  });

  it("without an OpenAI key every real message escalates to a person and is logged, so nothing is ever answered unconfigured", async () => {
    const db = new MemDb();
    const res = await handleVidaloSupportRelay(post("right"), db, { secret: "right", apiKey: undefined });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ action: "escalated", reason: "ai_not_configured", flagForHuman: true, reply: null });
    expect(db.supportLog).toHaveLength(1);
    expect(db.supportLog[0]).toMatchObject({ provider_message_id: "m9", action: "escalated", from_email: "bakker@example.nl" });
  });

  it("with a provider the reply carries the Dutch disclosure and the identity line", async () => {
    const provider: SupportModelProvider = {
      async complete({ system }) {
        if (system.startsWith("You classify")) return { text: JSON.stringify({ topic: "plans_and_features", platform_related: true, language: "nl", confidence: 0.9 }) };
        return { text: "Ik ben de automatische assistent van Vidalo. Een controle kost €149 excl. btw.\n\nVidalo Support" };
      },
    };
    const d = await decideSupportReply({ ...payload }, { config: VIDALO_SUPPORT_CONFIG, provider });
    expect(d.action).toBe("replied");
    expect(d.reply?.text).toContain("automatisch antwoord van de Vidalo-supportassistent");
    expect(d.reply?.text).toContain(supportIdentityLine("nl"));
  });
});
