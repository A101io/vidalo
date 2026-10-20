import Link from "next/link";
import { getI18n } from "@/lib/i18n";

function Check({ light }: { light?: boolean }) {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" className={`mt-1 shrink-0 ${light ? "text-white" : "text-groen"}`}>
      <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The two plans on the dark pricing band: Goed zetten (€149) and Goed houden (€49 per maand). */
export async function PriceBlock() {
  const { copy, href } = await getI18n();
  const P = copy.landing.prijs;
  return (
    <div className="flex flex-col gap-9">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h2 className="h2 mb-2">{P.h2}</h2>
          <p className="text-[17px] text-dark-text">{P.sub}</p>
        </div>
        <span className="text-[14px] text-grijs">{P.exclVat}</span>
      </div>
      <div data-motion="stagger" className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="hover-lift flex flex-col gap-4 rounded-[20px] bg-dark-panel p-7 sm:p-[30px]">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <span className="text-[18px] font-extrabold">{P.setup.name}</span>
            <span className="rounded-pill bg-groen-bg px-2.5 py-1 text-[12px] font-bold text-groen-ink">{P.setup.chip}</span>
          </div>
          <p className="text-[15px] text-grijs">{P.setup.audience}</p>
          <p className="text-[44px] font-extrabold leading-none sm:text-[52px]" style={{ letterSpacing: "-2px" }}>
            {P.setup.price} <span className="text-[15px] font-medium text-grijs" style={{ letterSpacing: 0 }}>{P.setup.unit}</span>
          </p>
          <ul className="flex flex-col gap-2 text-[15px] leading-[1.5] text-dark-text">
            {P.setup.includes.map((t) => (
              <li key={t} className="flex gap-2.5">
                <Check />
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-grijs">{P.setup.limit}</p>
          <Link href={href("/#top")} className="sheen mt-auto block rounded-btn border-[1.5px] border-white py-3.5 text-center text-[15px] font-extrabold text-white hover:border-blue-light hover:text-blue-light">
            {P.setup.button}
          </Link>
        </div>
        <div className="hover-lift flex flex-col gap-4 rounded-[20px] bg-blue p-7 text-white sm:p-[30px]">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <span className="text-[18px] font-extrabold">{P.monitor.name}</span>
            <span className="rounded-pill bg-white px-2.5 py-1 text-[12px] font-bold text-blue">{P.monitor.chip}</span>
          </div>
          <p className="text-[15px] text-blue-light">{P.monitor.audience}</p>
          <p className="text-[44px] font-extrabold leading-none sm:text-[52px]" style={{ letterSpacing: "-2px" }}>
            {P.monitor.price} <span className="text-[15px] font-medium" style={{ letterSpacing: 0 }}>{P.monitor.unit}</span>
          </p>
          <ul className="flex flex-col gap-2 text-[15px] leading-[1.5]">
            {P.monitor.includes.map((t) => (
              <li key={t} className="flex gap-2.5">
                <Check light />
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-blue-light">{P.monitor.limit}</p>
          <Link href={href("/#top")} className="sheen mt-auto block rounded-btn bg-white py-3.5 text-center text-[15px] font-extrabold text-ink hover:text-blue">
            {P.monitor.button}
          </Link>
        </div>
      </div>
      <div className="flex flex-wrap justify-between gap-5 text-[13px] text-grijs">
        <span>{P.footnote}</span>
        <Link href={href("/#vragen")} className="text-blue-light">
          {P.multi}
        </Link>
      </div>
    </div>
  );
}
