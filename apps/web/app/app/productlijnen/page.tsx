import Link from "next/link";
import { ENGINE_LABEL } from "@vidalo/core/types";
import { LINE_MARKETS, PRODUCT_LINE_LIMITS, countryName, productLineAccess, type ProductLineFieldError } from "@vidalo/core/shared";
import { getI18n } from "@/lib/i18n";
import { requireOwner } from "@/lib/owner";
import { ready } from "@/lib/core";
import { dateShort } from "@/lib/format";
import { Dot, Row, Section, SmallButton } from "@/components/OwnerUi";
import { fieldErrorText, linesReadable, loadProductLines, parseFout } from "@/lib/product-lines";
import { toFormInput } from "@/lib/line-form-input";
import { LineForm } from "./LineForm";

export const dynamic = "force-dynamic";

type Search = { nieuw?: string; opgeslagen?: string; status?: string; fout?: string };

export default async function ProductLinesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { business, session } = await requireOwner("/app/productlijnen");
  const { copy, lang, href } = await getI18n();
  const P = copy.productLines;
  const stipWord = copy.ownerArea.archive.stip;
  const access = productLineAccess(business, session.userId);
  // Off in production until the launch switch is on: nothing is read, so a database without the line tables is never asked.
  const items = linesReadable() ? await loadProductLines(business, await ready()) : [];
  const active = items.filter((i) => i.line.status === "active").length;
  const atLimit = active >= PRODUCT_LINE_LIMITS.lines;
  const canAdd = access.ok && !atLimit;
  const showForm = sp.nieuw === "1" && canAdd;

  // ?fout= is looked up, never echoed: a code the copy does not know says nothing.
  const fout = parseFout(sp.fout);
  const urlField: ProductLineFieldError | null = fout?.kind === "field" ? { field: fout.field, ...(fout.index !== undefined ? { index: fout.index } : {}), reason: fout.reason } : null;
  const urlFieldOk = urlField && fieldErrorText(P.errors as never, urlField.field, urlField.reason) ? urlField : null;
  const message = sp.opgeslagen ? P.saved : sp.status ? P.statusSaved : fout?.kind === "limit" ? P.limitError(PRODUCT_LINE_LIMITS.lines) : fout?.kind === "access" && access.ok ? P.access[fout.reason] : null;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex max-w-[760px] flex-col gap-3">
        <h1 className="h2">{P.h1}</h1>
        <p className="m-0 text-[17px] text-ink-2">{P.intro}</p>
      </header>

      <div role="status" aria-live="polite" className={message ? "max-w-[760px] rounded-xl bg-panel px-5 py-4 text-[15px]" : "sr-only"}>
        {message}
      </div>

      {!access.ok ? (
        <div className="flex max-w-[760px] flex-col gap-3 rounded-xl border-[1.5px] border-line px-5 py-4">
          <p className="m-0 text-[16px]">{P.access[access.reason]}</p>
          {access.reason === "not_verified" && (
            <p className="m-0">
              <Link href={href("/app/google?eerst=1")} className="text-[15px] font-bold text-blue hover:underline">
                {P.accessVerify}
              </Link>
            </p>
          )}
        </div>
      ) : showForm ? null : atLimit ? (
        <p className="m-0 max-w-[760px] text-[15px] text-ink-2">{P.limit(PRODUCT_LINE_LIMITS.lines)}</p>
      ) : (
        <div>
          <Link href={href("/app/productlijnen?nieuw=1")} className="btn-primary h-[52px] px-6">
            {P.add}
          </Link>
        </div>
      )}

      {showForm && (
        <LineForm
          lang={lang}
          businessId={business.id}
          lineId={null}
          initial={toFormInput(null)}
          marketOptions={LINE_MARKETS.map((code) => ({ code, name: countryName(code, lang) }))}
          cancelHref={href("/app/productlijnen")}
          disputed={false}
          urlError={urlFieldOk}
          title={P.form.newTitle}
        />
      )}

      {items.length === 0 ? (
        <p className="m-0 max-w-[640px] rounded-xl bg-panel px-5 py-4 text-[15px]">{P.empty}</p>
      ) : (
        items.map(({ line, markets }) => (
          <Section
            key={line.id}
            title={
              <Link href={href(`/app/productlijnen/${line.id}`)} className="hover:text-blue">
                {line.current.name}
              </Link>
            }
            aside={
              <>
                {line.current.category}
                {line.status === "discontinued" && <span className="pill ml-3">{P.discontinued}</span>}
              </>
            }
          >
            <ul className="m-0 list-none p-0">
              {markets.map((m, i) => {
                const name = countryName(m.market, lang);
                return (
                  <Row
                    key={m.market}
                    last={i === markets.length - 1}
                    right={
                      <SmallButton href={href(`/app/productlijnen/${line.id}?markt=${m.market}`)}>
                        {P.view}
                        <span className="sr-only">
                          {" "}
                          {line.current.name}, {name}
                        </span>
                      </SmallButton>
                    }
                  >
                    <p className="m-0 font-bold">{name}</p>
                    {m.checkedAt ? (
                      <>
                        <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-[15px]">
                          {m.engineStips.map((e) => (
                            <li key={e.engine}>
                              <Dot tone={e.stip} />
                              {ENGINE_LABEL[e.engine]} <span className="text-muted">{stipWord[e.stip]}</span>
                            </li>
                          ))}
                        </ul>
                        <p className="m-0 mt-2 text-[15px] text-ink-2">
                          {P.openErrors(m.openErrors)}
                          {m.named && ` · ${P.named(m.named.named, m.named.answers)}`}
                        </p>
                        <p className="m-0 mt-1 text-[14px] text-muted">{P.checkedOn(dateShort(m.checkedAt))}</p>
                      </>
                    ) : (
                      <p className="m-0 mt-1 text-[15px] text-muted">{P.notChecked}</p>
                    )}
                  </Row>
                );
              })}
            </ul>
          </Section>
        ))
      )}
    </div>
  );
}
