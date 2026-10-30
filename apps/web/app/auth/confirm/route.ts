import { confirmSignIn } from "@/lib/auth-confirm";

/** The sign-in link from the e-mail lands here (lib/auth-confirm.ts). */
export async function GET(req: Request) {
  return confirmSignIn(req);
}
