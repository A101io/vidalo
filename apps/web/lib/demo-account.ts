/** Mock seed for the account lifecycle (lane A): starts as a no-op. Runs after seedOwnerArea. Mock only. */
import type { Db } from "@vidalo/core/db";

export async function seedAccountLifecycle(db: Db): Promise<void> {}
