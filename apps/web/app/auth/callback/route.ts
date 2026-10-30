import { confirmSignIn } from "@/lib/auth-confirm";

/** Older sign-in links (before 22 Oct 2026) point here; same handling as /auth/confirm. */
export async function GET(req: Request) {
  return confirmSignIn(req);
}
