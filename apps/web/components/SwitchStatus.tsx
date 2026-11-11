"use client";

import { useSearchParams } from "next/navigation";

/**
 * The one polite status region of the owner area for a business switch: it is always in the page,
 * and holds the sentence only on the load that follows chooseBusiness (?gewisseld=1).
 */
export function SwitchStatus({ sentence }: { sentence: string }) {
  const switched = useSearchParams().get("gewisseld") === "1";
  return (
    <p role="status" aria-live="polite" className={switched ? "mb-6 text-[15px] text-ink-2" : "sr-only"}>
      {switched ? sentence : ""}
    </p>
  );
}
