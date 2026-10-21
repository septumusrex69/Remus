import { useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { contactName, listQuoteItems, loadClientDirectory, quoteAttachments, quotes as quotesApi, signedUrls } from '../../../lib/api'
import { QUOTE_FILES_BUCKET } from '../../../lib/supabase'
import { formatDate, formatZAR } from '../../../lib/format'
import { quoteTotals } from '../../../lib/quoteMath'
import { useLoad } from '../../../hooks/useLoad'
import { Button, ErrorBanner, Spinner } from '../../../components/ui'
import { paths } from '../paths'
import { useBuild } from '../BuildContext'
import type { QuoteItem } from '../../../types'

/** Client-facing quote. Browser Print → Save as PDF gives an A4 document (see print CSS). */
export function QuotePrint() {
  const { id = '' } = useParams()
  const { settings } = useBuild()
  const { data, error, loading } = useLoad(async () => {
    const [quote, items, dir, attachments] = await Promise.all([quotesApi.get(id), listQuoteItems(id), loadClientDirectory(), quoteAttachments.list({ quote_id: id })])
    const gallery = attachments.filter((a) => a.show_on_quote && a.mime_type?.startsWith('image/'))
    const urls = await signedUrls(QUOTE_FILES_BUCKET, gallery.map((a) => a.file_path))
    return { quote, items, dir, gallery, urls }
  }, [id])

  useEffect(() => {
    document.title = data?.quote ? `Quote ${data.quote.number ?? ''} – ${settings?.name ?? 'Remus'}` : 'Remus'
    return () => {
      document.title = 'Remus'
    }
  }, [data?.quote, settings?.name])

  const groups = useMemo(() => {
    const g: { section: string | null; items: QuoteItem[] }[] = []
    for (const it of data?.items ?? []) {
      const s = it.section || null
      let grp = g.find((x) => x.section === s)
      if (!grp) g.push((grp = { section: s, items: [] }))
      grp.items.push(it)
    }
    return g
  }, [data?.items])

  if (loading && !data) return <Spinner />
  if (!data?.quote) return <ErrorBanner error={error ?? 'Quote not found'} />
  const { quote, items, dir } = data
  const t = quoteTotals(items, quote.discount, quote.vat_rate)
  const company = quote.company_id ? dir.companyById.get(quote.company_id) : null
  const contact = quote.contact_id ? dir.contactById.get(quote.contact_id) : null
  const showSections = groups.length > 1 || groups[0]?.section

  return (
    <div className="min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between px-4">
        <Link to={paths.quote(quote.id)} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft size={14} /> Back to editor
        </Link>
        <Button variant="dark" onClick={() => window.print()}>
          <Printer size={15} /> Print / Save as PDF
        </Button>
      </div>

      <article className="print-page mx-auto max-w-[210mm] bg-white px-6 py-8 text-[13px] leading-relaxed text-slate-800 shadow-sm sm:px-12 sm:py-12">
        {/* Letterhead */}
        <header className="flex flex-col justify-between gap-6 border-b-4 border-amber-500 pb-6 sm:flex-row">
          <div>
            {settings?.logo_url ? (
              <img src={settings.logo_url} alt={settings.name} className="mb-2 max-h-16" />
            ) : (
              <p className="text-2xl font-bold text-slate-900">{settings?.name}</p>
            )}
            <div className="whitespace-pre-line text-xs text-slate-500">
              {settings?.address}
              {settings?.phone && `\nTel: ${settings.phone}`}
              {settings?.email && `\n${settings.email}`}
              {settings?.reg_no && `\nReg. no: ${settings.reg_no}`}
              {settings?.vat_no && `\nVAT no: ${settings.vat_no}`}
            </div>
          </div>
          <div className="sm:text-right">
            <p className="text-3xl font-light tracking-wide text-slate-900">QUOTATION</p>
            <table className="mt-2 text-xs sm:ml-auto">
              <tbody>
                <tr><td className="pr-3 text-slate-500">Quote no.</td><td className="font-semibold">{quote.number}</td></tr>
                <tr><td className="pr-3 text-slate-500">Date</td><td>{formatDate(quote.issue_date)}</td></tr>
                {quote.valid_until && <tr><td className="pr-3 text-slate-500">Valid until</td><td>{formatDate(quote.valid_until)}</td></tr>}
              </tbody>
            </table>
          </div>
        </header>

        <section className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Prepared for</p>
            {company && <p className="font-semibold">{company.name}</p>}
            {contact && <p className={company ? '' : 'font-semibold'}>{contactName(contact)}</p>}
            <p className="whitespace-pre-line text-slate-600">{company?.address ?? contact?.address ?? ''}</p>
            {(contact?.email || company?.email) && <p className="text-slate-600">{contact?.email ?? company?.email}</p>}
            {company?.vat_no && <p className="text-slate-600">VAT no: {company.vat_no}</p>}
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Project</p>
            <p className="font-semibold">{quote.title}</p>
            {quote.site_address && <p className="text-slate-600">{quote.site_address}</p>}
          </div>
        </section>

        <table className="mt-8 w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
              <th className="py-2 pr-2">Description</th>
              <th className="w-14 py-2 px-2 text-right">Qty</th>
              <th className="w-12 py-2 px-2">Unit</th>
              <th className="w-28 py-2 px-2 text-right">Rate</th>
              <th className="w-32 py-2 pl-2 text-right">Amount</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.section ?? '_'} className="print-avoid-break">
              {showSections && (
                <tr>
                  <td colSpan={5} className="pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-700">{g.section ?? 'General'}</td>
                </tr>
              )}
              {g.items.map((it) => (
                <tr key={it.id} className="border-b border-slate-100">
                  <td className="py-1.5 pr-2">{it.description}</td>
                  <td className="tabular py-1.5 px-2 text-right">{Number(it.quantity).toLocaleString('en-ZA')}</td>
                  <td className="py-1.5 px-2">{it.unit}</td>
                  <td className="tabular py-1.5 px-2 text-right">{formatZAR(it.unit_price)}</td>
                  <td className="tabular py-1.5 pl-2 text-right">{formatZAR(Number(it.quantity) * Number(it.unit_price))}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>

        <div className="print-avoid-break mt-6 flex justify-end">
          <dl className="tabular w-full max-w-xs space-y-1">
            <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd>{formatZAR(t.subtotal)}</dd></div>
            {t.discount > 0 && <div className="flex justify-between"><dt className="text-slate-500">Discount</dt><dd>-{formatZAR(t.discount)}</dd></div>}
            <div className="flex justify-between"><dt className="text-slate-500">Total excl. VAT</dt><dd>{formatZAR(t.totalExcl)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">VAT ({quote.vat_rate}%)</dt><dd>{formatZAR(t.vat)}</dd></div>
            <div className="flex justify-between border-t-2 border-slate-800 pt-1.5 text-base font-bold"><dt>Total</dt><dd>{formatZAR(t.totalIncl)}</dd></div>
          </dl>
        </div>

        {data.gallery.length > 0 && (
          <section className="mt-10">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Visuals</p>
            <div className="grid grid-cols-2 gap-4">
              {data.gallery.map((a) => (
                <figure key={a.id} className="print-avoid-break">
                  {data.urls.get(a.file_path) && (
                    <img src={data.urls.get(a.file_path)} alt={a.caption ?? a.file_name} className="aspect-[4/3] w-full rounded object-cover" />
                  )}
                  {a.caption && <figcaption className="mt-1 text-xs text-slate-500">{a.caption}</figcaption>}
                </figure>
              ))}
            </div>
          </section>
        )}

        {quote.notes && (
          <section className="print-avoid-break mt-8">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Notes</p>
            <p className="whitespace-pre-line text-slate-700">{quote.notes}</p>
          </section>
        )}
        {quote.terms && (
          <section className="print-avoid-break mt-6">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Terms & conditions</p>
            <p className="whitespace-pre-line text-xs text-slate-600">{quote.terms}</p>
          </section>
        )}
        {settings?.bank_details && (
          <section className="print-avoid-break mt-6 rounded bg-slate-50 p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Banking details</p>
            <p className="whitespace-pre-line text-xs text-slate-700">{settings.bank_details}</p>
          </section>
        )}
        <section className="print-avoid-break mt-10 grid grid-cols-2 gap-8 text-xs text-slate-500">
          <div className="border-t border-slate-300 pt-1">Accepted by (name & signature)</div>
          <div className="border-t border-slate-300 pt-1">Date</div>
        </section>
      </article>
    </div>
  )
}
