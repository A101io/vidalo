"use client";

import { useState } from "react";
import type { Facts, Hours, PriceItem } from "@vidalo/core/types";
import { SECTOR_LIST } from "@vidalo/core/prompts";
import { copyFor, type CopyShape, type Lang } from "@vidalo/core/copy";
import { saveFacts } from "./actions";

type FactsCopy = CopyShape["facts"];

/** Chip input: a list of short strings; Enter or comma adds, × removes. */
function ChipInput({ name, label, hint, initial, F }: { name: string; label: string; hint?: string; initial: string[]; F: FactsCopy }) {
  const [items, setItems] = useState(initial);
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim().replace(/,$/, "");
    if (v && !items.includes(v)) setItems([...items, v]);
    setDraft("");
  };
  return (
    <div>
      <label htmlFor={`chip-${name}`} className="field-label">
        {label}
      </label>
      <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-[10px] border-[1.5px] border-line bg-white p-2 focus-within:border-ink">
        {items.map((it) => (
          <span key={it} className="inline-flex items-center gap-1 rounded-pill bg-panel px-2.5 py-0.5 text-[14px]">
            {it}
            <input type="hidden" name={name} value={it} />
            <button type="button" aria-label={`${F.fields.remove}: ${it}`} onClick={() => setItems(items.filter((x) => x !== it))} className="ml-1 text-muted hover:text-ink">
              ×
            </button>
          </span>
        ))}
        <input
          id={`chip-${name}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
            if (e.key === "Backspace" && !draft && items.length) setItems(items.slice(0, -1));
          }}
          onBlur={add}
          placeholder={hint ?? F.fields.addItem}
          className="min-w-[160px] flex-1 bg-transparent px-1 text-[15px] outline-none placeholder:text-muted"
        />
      </div>
    </div>
  );
}

function HoursRows({ initial, F }: { initial: Hours[]; F: FactsCopy }) {
  const [rows, setRows] = useState<Hours[]>(
    [0, 1, 2, 3, 4, 5, 6].map((d) => initial.find((h) => h.day === d) ?? { day: d as Hours["day"], open: "09:00", close: "17:00", closed: d === 6 }),
  );
  const update = (i: number, patch: Partial<Hours>) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <table className="w-full text-[15px]">
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.day} className="border-t-[1.5px] border-line">
            <th scope="row" className="w-[90px] py-2 pr-3 text-left align-top font-medium sm:w-[110px]">
              {F.days[r.day]}
            </th>
            <td className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-[14px]">
                  <input type="checkbox" name={`hours.${r.day}.closed`} checked={r.closed} onChange={(e) => update(i, { closed: e.target.checked })} />
                  {F.fields.closed}
                </label>
                {!r.closed && (
                  <>
                    <input type="time" name={`hours.${r.day}.open`} value={r.open ?? ""} onChange={(e) => update(i, { open: e.target.value })} className="field-sm w-[112px] px-2 text-[14px]" aria-label={`${F.days[r.day]} ${F.fields.open}`} />
                    <span className="text-muted">–</span>
                    <input type="time" name={`hours.${r.day}.close`} value={r.close ?? ""} onChange={(e) => update(i, { close: e.target.value })} className="field-sm w-[112px] px-2 text-[14px]" aria-label={`${F.days[r.day]} ${F.fields.close}`} />
                  </>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PriceRows({ initial, F }: { initial: PriceItem[]; F: FactsCopy }) {
  const [rows, setRows] = useState<PriceItem[]>(initial);
  return (
    <div className="space-y-2">
      {rows.map((p, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto] items-center gap-2 sm:grid-cols-[1fr_110px_120px_auto]">
          <input name={`price.${i}.label`} defaultValue={p.label} placeholder={F.fields.priceLabel} className="field-sm" aria-label={F.fields.priceLabel} />
          <input name={`price.${i}.amount`} type="number" step="0.01" min="0" defaultValue={p.amount} placeholder="0,00" className="field-sm" aria-label={F.fields.priceAmount} />
          <input name={`price.${i}.unit`} defaultValue={p.unit ?? ""} placeholder={F.fields.priceUnit} className="field-sm" aria-label={F.fields.priceUnit} />
          <button type="button" className="text-[14px] text-muted hover:text-ink" onClick={() => setRows(rows.filter((_, idx) => idx !== i))} aria-label={F.fields.remove}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn-link" onClick={() => setRows([...rows, { label: "", amount: 0 }])}>
        + {F.fields.addItem}
      </button>
    </div>
  );
}

function UrgencyFields({ initial, F }: { initial: Facts["urgency"]; F: FactsCopy }) {
  const [available, setAvailable] = useState(Boolean(initial?.available));
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor="urgencyAvailable" className="field-label">{F.fields.urgencyAvailable}</label>
        <select id="urgencyAvailable" name="urgencyAvailable" value={available ? "true" : "false"} onChange={(e) => setAvailable(e.target.value === "true")} className="field-sm">
          <option value="false">{F.fields.no}</option>
          <option value="true">{F.fields.yes}</option>
        </select>
      </div>
      {available && (
        <div>
          <label htmlFor="urgencyHours" className="field-label">{F.fields.urgencyHours}</label>
          <input id="urgencyHours" name="urgencyHours" defaultValue={initial?.hoursNl ?? ""} placeholder={F.fields.urgencyHoursHint} className="field-sm" />
        </div>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="card p-5 sm:p-6">
      <legend className="sr-only">{title}</legend>
      <h2 className="h3 mb-4">{title}</h2>
      <div className="space-y-4">{children}</div>
    </fieldset>
  );
}

export function FactsForm({ facts, lang, country, countries }: { facts: Facts; lang: Lang; country: string; countries: { code: string; name: string }[] }) {
  const copy = copyFor(lang);
  const F = copy.facts;
  const f = F.fields;
  return (
    <form action={saveFacts} className="space-y-4">
      <Group title={F.groups.basics}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="name" className="field-label">{f.name}</label>
            <input id="name" name="name" required defaultValue={facts.name} className="field-sm" />
          </div>
          <div>
            <label htmlFor="place" className="field-label">{f.place}</label>
            <input id="place" name="place" required defaultValue={facts.place} className="field-sm" />
          </div>
          <div>
            <label htmlFor="address" className="field-label">{f.address}</label>
            <input id="address" name="address" defaultValue={facts.address ?? ""} className="field-sm" />
          </div>
          <div>
            <label htmlFor="postcode" className="field-label">{f.postcode}</label>
            <input id="postcode" name="postcode" defaultValue={facts.postcode ?? ""} className="field-sm" />
          </div>
          <div>
            <label htmlFor="country" className="field-label">{f.country}</label>
            <select id="country" name="country" defaultValue={country} aria-describedby="country-hint" className="field-sm">
              {countries.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
            <p id="country-hint" className="mt-1 text-[13px] text-muted">{f.countryHint}</p>
          </div>
          <div>
            <label htmlFor="openStatus" className="field-label">{f.openStatus}</label>
            <select id="openStatus" name="openStatus" defaultValue={facts.openStatus} className="field-sm">
              {Object.entries(f.openStatusOptions).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>
      </Group>

      <Group title={F.groups.contact}>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="phone" className="field-label">{f.phone}</label>
            <input id="phone" name="phone" type="tel" defaultValue={facts.phone ?? ""} className="field-sm" />
          </div>
          <div>
            <label htmlFor="email" className="field-label">{f.email}</label>
            <input id="email" name="email" type="email" defaultValue={facts.email ?? ""} className="field-sm" />
          </div>
          <div>
            <label htmlFor="website" className="field-label">{f.website}</label>
            <input id="website" name="website" type="url" defaultValue={facts.website ?? ""} className="field-sm" />
          </div>
        </div>
      </Group>

      <Group title={F.groups.hours}>
        <HoursRows initial={facts.hours} F={F} />
      </Group>

      <Group title={F.groups.services}>
        <ChipInput name="servicesYes" label={f.servicesYes} initial={facts.servicesYes} F={F} />
        <ChipInput name="servicesNo" label={f.servicesNo} initial={facts.servicesNo} F={F} />
      </Group>

      <Group title={F.groups.prices}>
        <PriceRows initial={facts.prices} F={F} />
      </Group>

      <Group title={F.groups.policies}>
        <ChipInput name="policies" label={f.policies} hint={f.policiesHint} initial={facts.policies} F={F} />
      </Group>

      <Group title={F.groups.payment}>
        <ChipInput name="paymentMethods" label={f.paymentMethods} initial={facts.paymentMethods} F={F} />
      </Group>

      <Group title={F.groups.confusion}>
        <ChipInput name="notConfusedWith" label={f.notConfusedWith} hint={f.notConfusedWithHint} initial={facts.notConfusedWith} F={F} />
      </Group>

      <Group title={F.groups.area}>
        <ChipInput name="serviceAreaPlaces" label={f.serviceAreaPlaces} hint={f.serviceAreaPlacesHint} initial={facts.serviceArea?.places ?? []} F={F} />
        <div className="max-w-[220px]">
          <label htmlFor="serviceAreaRadiusKm" className="field-label">{f.serviceAreaRadiusKm}</label>
          <input id="serviceAreaRadiusKm" name="serviceAreaRadiusKm" type="number" min="1" step="1" defaultValue={facts.serviceArea?.radiusKm ?? ""} className="field-sm" />
        </div>
      </Group>

      <Group title={F.groups.urgency}>
        <UrgencyFields initial={facts.urgency} F={F} />
      </Group>

      <Group title={F.groups.credentials}>
        <ChipInput name="credentials" label={f.credentials} hint={f.credentialsHint} initial={facts.credentials ?? []} F={F} />
      </Group>

      <Group title={F.groups.sector}>
        <div className="max-w-[420px]">
          <label htmlFor="sector" className="field-label">{f.sector}</label>
          <select id="sector" name="sector" defaultValue={facts.sector ?? ""} className="field-sm">
            <option value="">{copy.sectorNone}</option>
            {SECTOR_LIST.map((p) => (
              <option key={p.slug} value={p.slug}>{copy.sectors[p.slug]}</option>
            ))}
          </select>
          <p className="mt-1.5 text-[13px] text-muted">{copy.sectorHint}</p>
        </div>
      </Group>

      <div className="flex justify-end">
        <button type="submit" className="btn-primary h-[52px]">
          {F.submit}
        </button>
      </div>
    </form>
  );
}
