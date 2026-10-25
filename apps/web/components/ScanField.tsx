import { getI18n } from "@/lib/i18n";
import { TurnstileWidget } from "@/components/TurnstileWidget";

/**
 * Name + place in one bordered field, blue button underneath (docs/DESIGN_G.md).
 * Plain form POST to /api/scan so it works without JavaScript.
 */
export async function ScanField({
  defaultName = "",
  defaultPlace = "",
  namePlaceholder,
  button,
  note = true,
  id = "scan",
  className = "",
  style,
}: {
  defaultName?: string;
  defaultPlace?: string;
  namePlaceholder?: string;
  button?: string;
  note?: boolean;
  id?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { copy } = await getI18n();
  const s = copy.scanField;
  return (
    <form action="/api/scan" method="post" className={`flex w-full flex-col gap-2.5 ${className}`} style={style}>
      <div className="scan-box flex overflow-hidden rounded-btn border-[1.5px] border-ink bg-white">
        <label htmlFor={`${id}-q`} className="sr-only">
          {s.nameLabel}
        </label>
        <input
          id={`${id}-q`}
          name="q"
          type="text"
          required
          autoComplete="organization"
          defaultValue={defaultName}
          placeholder={namePlaceholder ?? s.namePlaceholder}
          className="h-[58px] min-w-0 flex-1 border-0 bg-white px-4 text-[16px] placeholder:text-muted focus:outline-none"
        />
        <label htmlFor={`${id}-place`} className="sr-only">
          {s.placeLabel}
        </label>
        <input
          id={`${id}-place`}
          name="place"
          type="text"
          autoComplete="address-level2"
          defaultValue={defaultPlace}
          placeholder={s.placePlaceholder}
          className="h-[58px] w-[110px] border-0 border-l-[1.5px] border-ink bg-white px-4 text-[16px] placeholder:text-muted focus:outline-none sm:w-[130px]"
        />
      </div>
      <TurnstileWidget />
      <button type="submit" className="btn-primary h-14">
        {button ?? s.button}
      </button>
      {note && <p className="text-[14px] text-muted">{s.note}</p>}
    </form>
  );
}
