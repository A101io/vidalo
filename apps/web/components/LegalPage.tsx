import { getI18n } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ComingSoonFooter } from "@/components/ComingSoonFooter";
import { behindGate } from "@/lib/gate-state";

type Table = { head: readonly string[]; rows: readonly (readonly string[])[] };
/** A string in `p` is a paragraph (a numbered clause when the doc is `numbered`); an array is a sub-list of the paragraph before it. */
type Doc = { title: string; intro: string; numbered?: boolean; sections: readonly { h: string; p: readonly (string | readonly string[])[]; table?: Table }[] };

/** Behind the launch gate the page keeps the coming-soon footer, so a visitor from /binnenkort never reaches the closed site's links. */
export async function LegalPage({ doc, draft = true }: { doc: Doc; draft?: boolean }) {
  const [{ copy }, gated] = [await getI18n(), await behindGate()];
  const l = copy.legal;
  return (
    <>
      <SiteHeader variant="minimal" />
      <main className="wrap max-w-[760px] py-12 sm:py-16">
        {l.draft && draft && <p className="mb-6 rounded-xl border-[1.5px] border-line px-4 py-3 text-[14px] text-ink-2">{l.draftNotice}</p>}
        <h1 className="h2">{doc.title}</h1>
        <p className="mt-2 text-[14px] text-muted">{l.updated}</p>
        <p className="lead mt-6">{doc.intro}</p>
        {doc.sections.map((s, si) => (
          <section key={s.h} className="mt-10">
            <h2 className="h3">{doc.numbered ? `${si + 1}. ${s.h}` : s.h}</h2>
            {s.p.map((para, pi) =>
              typeof para === "string" ? (
                <p key={pi} className="mt-3 text-[16px] leading-relaxed text-ink-2">
                  {doc.numbered && <span className="mr-2 font-semibold text-ink">{`${si + 1}.${s.p.slice(0, pi + 1).filter((x) => typeof x === "string").length}`}</span>}
                  {para}
                </p>
              ) : (
                <ul key={pi} className={`mt-2 space-y-1 pl-6 text-[16px] leading-relaxed text-ink-2 ${doc.numbered ? "ml-8 list-[lower-alpha]" : "list-disc"}`}>
                  {para.map((item, ii) => (
                    <li key={ii}>{item}</li>
                  ))}
                </ul>
              ),
            )}
            {s.table && (
              <div className="card mt-4 overflow-x-auto">
                <table className="w-full text-[15px]">
                  <thead>
                    <tr className="border-b-[1.5px] border-line text-left text-[13px] text-muted">
                      {s.table.head.map((h) => (
                        <th key={h} className="px-4 py-3 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y-[1px] divide-line">
                    {s.table.rows.map((row) => (
                      <tr key={row[0]} className="align-top">
                        {row.map((cell, i) => (
                          <td key={cell} className={`px-4 py-3 ${i === 0 ? "whitespace-nowrap font-mono text-[14px]" : "text-ink-2"}`}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
        <p className="mt-12 text-[15px] text-ink-2">{l.contact}</p>
      </main>
      {gated ? <ComingSoonFooter /> : <SiteFooter />}
    </>
  );
}
