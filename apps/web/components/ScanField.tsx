import { getI18n } from "@/lib/i18n";
import { TurnstileWidget } from "@/components/TurnstileWidget";

/**
 * Name + place in one bordered field, the e-mail address under it (the report
 * goes there; nothing runs without it, core/shared/free-check.ts), an unticked
 * box for news about Vidalo, blue button underneath (docs/DESIGN_G.md).
 * Plain form POST to /api/scan so it works without JavaScript.
 */
export async function ScanField({
  defaultName = "",
  defaultPlace = "",
  defaultEmail,
  emailInvalid = false,
  namePlaceholder,
  button,
  note = true,
  id = "scan",
  className = "",
  style,
}: {
  defaultName?: string;
  defaultPlace?: string;
  /** A signed-in visitor's own address (/controle): filled in, still editable. */
  defaultEmail?: string;
  /** /scan/kies came back with ?fout=mail: say so under the address field. */
  emailInvalid?: boolean;
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
      <label htmlFor={`${id}-email`} className="sr-only">
        {s.emailLabel}
      </label>
      <input
        id={`${id}-email`}
        name="email"
        type="email"
        required
        autoComplete="email"
        defaultValue={defaultEmail}
        placeholder={s.emailPlaceholder}
        aria-invalid={emailInvalid || undefined}
        aria-describedby={emailInvalid ? `${id}-email-error` : undefined}
        className="scan-box h-[58px] w-full rounded-btn border-[1.5px] border-ink bg-white px-4 text-[16px] placeholder:text-muted focus:outline-none"
      />
      {emailInvalid && (
        <p id={`${id}-email-error`} className="text-[14px] text-rood">
          {s.emailInvalid}
        </p>
      )}
      <label className="flex items-start gap-2.5 text-[13px] leading-[1.45] text-ink-2 sm:text-[14px]">
        <input type="checkbox" name="marketing" value="ja" className="mt-[2px] h-4 w-4 shrink-0 accent-[#111827]" />
        <span>{s.marketing}</span>
      </label>
      <TurnstileWidget />
      <button type="submit" className="btn-primary h-14">
        {button ?? s.button}
      </button>
      {note && <p className="text-[14px] text-muted">{s.note}</p>}
    </form>
  );
}
