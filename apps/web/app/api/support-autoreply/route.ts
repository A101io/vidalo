import { handleVidaloSupportRelay } from "@vidalo/core/support";
import { ready } from "@/lib/db";
import { log } from "@vidalo/core/shared";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/**
 * POST — the support@vidalo.io mailbox relay asks what to do with one message
 * (A101 kit adopt/support; docs/mail.md). Authenticated by SUPPORT_RELAY_SECRET
 * in `x-relay-secret`; 503 to everything while it is unset. The decision, the
 * drafted reply and the content scan are packages/core/src/support; every
 * outcome is a row in support_autoreply_log (migration 0010). Nothing is sent
 * from here: the relay sends the reply from inside the mailbox, as
 * support@vidalo.io, or labels the thread for a person.
 *
 * Not behind the launch gate on purpose: the mailbox exists before the site opens.
 */
export async function POST(req: Request) {
  const db = await ready();
  const res = await handleVidaloSupportRelay(req, db, {
    secret: env.supportRelaySecret,
    apiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
    model: process.env.CHAT_MODEL?.trim() || undefined,
  });
  if (res.status === 401) log.warn("security.refused", { route: "support-autoreply", reason: "relay_secret" });
  return res;
}
