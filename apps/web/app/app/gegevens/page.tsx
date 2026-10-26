import { getI18n } from "@/lib/i18n";
import { requireVerifiedOwner } from "@/lib/owner";
import { loadDashboard } from "@/lib/reads";
import { dateShort } from "@/lib/format";
import { FactsForm } from "./FactsForm";
import { countryOptions } from "@vidalo/core/shared";

export default async function FactsPage({ searchParams }: { searchParams: Promise<{ opgeslagen?: string; fout?: string }> }) {
  const sp = await searchParams;
  const { business } = await requireVerifiedOwner("/app/gegevens");
  const { facts } = await loadDashboard(business.id);
  const { copy, lang } = await getI18n();
  const F = copy.facts;
  const initial = facts ?? {
    businessId: business.id,
    version: 0,
    provisional: true,
    verifiedAt: null,
    name: business.name,
    place: business.place,
    address: null,
    postcode: null,
    phone: null,
    email: null,
    website: business.domain ? `https://${business.domain}` : null,
    openStatus: "open" as const,
    hours: [],
    servicesYes: [],
    servicesNo: [],
    prices: [],
    policies: [],
    paymentMethods: [],
    notConfusedWith: [],
  };
  return (
    <div className="space-y-6">
      <header>
        <h1 className="h2">{F.h1}</h1>
        <p className="mt-2 text-[17px] text-ink-2">{F.intro}</p>
        {sp.opgeslagen === "1" ? (
          <p className="mt-3 rounded-xl bg-groen-bg px-4 py-3 text-[15px] text-groen-ink">{F.saved}</p>
        ) : initial.provisional ? (
          <p className="mt-3 text-[14px] text-muted">{F.provisionalNotice}</p>
        ) : (
          <p className="mt-3 text-[14px] text-muted">{F.verifiedNotice(dateShort(initial.verifiedAt ?? new Date()))}</p>
        )}
        {sp.fout === "1" && <p className="mt-3 text-[14px] text-rood">{copy.errors.generic}</p>}
      </header>
      <FactsForm facts={initial} lang={lang} country={business.country} countries={countryOptions(lang)} />
    </div>
  );
}
