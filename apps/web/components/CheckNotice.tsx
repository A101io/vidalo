import type { CopyShape } from "@vidalo/core/copy";

/** The answer to a removal (app/controle/actions.ts), shown once on the page that lists the checks. */
export function CheckNotice({ code, copy }: { code: string | undefined; copy: CopyShape["checks"] }) {
  const text = code === "weg" ? copy.removedDone : code === "los" ? copy.removedUnlinked : code === "not_yours" || code === "not_finished" || code === "latest" ? copy.refused[code] : null;
  return text ? (
    <p role="status" className="mt-3 text-[15px]">
      {text}
    </p>
  ) : null;
}
