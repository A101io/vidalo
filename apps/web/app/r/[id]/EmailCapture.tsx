import { getI18n } from "@/lib/i18n";

/**
 * "Stuur dit rapport naar mij": one field with a black Verstuur button. Plain POST.
 * Once mailed it says so and points at the full check (#plan): the block had no action left (11 Nov 2026).
 * Not a "send to someone else" field: a forwarded address would become the requester and get the
 * follow-up mails (compliance, Tw 11.7), and the privacy text does not cover a third party's address.
 */
export async function EmailCapture({ scanRunId, businessId, sent, invalid, problem, cta }: { scanRunId: string; businessId: string; sent: boolean; invalid: boolean; problem?: "busy" | "enough"; cta?: string }) {
  const { copy } = await getI18n();
  const e = copy.result.email;
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="text-[16px] font-bold">{sent ? e.h3Sent : e.h3}</h3>
      {sent ? (
        <>
          <p className="text-[15px] text-ink-2">{e.sent}</p>
          {cta && (
            <a href="#plan" className="btn-sm self-start print:hidden">
              {cta}
            </a>
          )}
        </>
      ) : (
        <form action="/api/report-email" method="post">
          <input type="hidden" name="scan" value={scanRunId} />
          <input type="hidden" name="business" value={businessId} />
          <label htmlFor="report-email" className="sr-only">
            {e.label}
          </label>
          <div className="flex overflow-hidden rounded-btn border-[1.5px] border-ink bg-white">
            <input id="report-email" name="email" type="email" required placeholder={e.placeholder} className="h-[52px] min-w-0 flex-1 border-0 bg-white px-4 text-[15px] placeholder:text-muted focus:outline-none" />
            <button type="submit" className="h-[52px] shrink-0 bg-ink px-5 text-[14px] font-extrabold text-white hover:bg-[#1f2937]">
              {e.button}
            </button>
          </div>
          {invalid && <p className="mt-2 text-[14px] text-rood">{e.invalid}</p>}
          {problem && <p className="mt-2 text-[14px] text-rood">{e[problem]}</p>}
        </form>
      )}
    </div>
  );
}
