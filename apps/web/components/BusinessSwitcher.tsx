import { chooseBusiness } from "@/app/app/business-actions";
import type { BusinessRecord } from "@vidalo/core/db";

/**
 * Shown by the owner layout only when the login holds more than one business. A plain form with a
 * labelled select and a button: works without JavaScript, by keyboard alone, and the server decides
 * (chooseBusiness checks membership again). `next` is the page the owner is on.
 */
export function BusinessSwitcher({ businesses, activeId, next, label, submit }: { businesses: BusinessRecord[]; activeId: string; next: string; label: string; submit: string }) {
  return (
    <form action={chooseBusiness} className="flex min-w-0 flex-wrap items-center gap-2 text-[14px]">
      <label htmlFor="business-switcher" className="text-muted">
        {label}
      </label>
      <select id="business-switcher" name="business" defaultValue={activeId} className="min-w-0 max-w-full sm:max-w-[16rem] h-11 rounded-btn border-[1.5px] border-line bg-white px-2">
        {businesses.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}, {b.place}
          </option>
        ))}
      </select>
      <input type="hidden" name="next" value={next} />
      <button type="submit" className="btn-sm">
        {submit}
      </button>
    </form>
  );
}
