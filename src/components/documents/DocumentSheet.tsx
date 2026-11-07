import { Fragment, useMemo } from 'react'
import clsx from 'clsx'
import { GAP, parseDocument } from '../../lib/documentTemplates'

/**
 * A DOCUMENT ON THE LETTERHEAD, ON SCREEN (Remus · Handover 8; Raptor's LetterPage, adapted). The same
 * letterhead the PDF draws (api/_lib/documentPdf.ts): the logo, then the company's name, address, phone,
 * email, registration and VAT numbers from Settings, a rule, and the words. Raptor's letterhead is an
 * uploaded A4 picture; Remus's is the company's details, so it is drawn rather than painted behind.
 *
 * Paper is paper: white with dark words whatever the skin, as a printed page is. It narrows with the screen
 * (a phone shows the same page, smaller margins), and never scrolls sideways.
 */
export interface SheetCompany {
  name?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  reg_no?: string | null
  vat_no?: string | null
  logo_url?: string | null
}

export interface SheetSignature {
  name: string
  at: string
  png: string
}

export function DocumentSheet({ company, body, signable, clientName, signed, className }: {
  company: SheetCompany | null
  body: string
  signable?: boolean
  clientName?: string | null
  signed?: SheetSignature | null
  className?: string
}) {
  const blocks = useMemo(() => parseDocument(body), [body])
  const lines = [
    ...(company?.address ? company.address.split(/\r?\n/) : []),
    company?.phone ? `Tel: ${company.phone}` : '',
    company?.email ?? '',
    company?.reg_no ? `Reg. no: ${company.reg_no}` : '',
    company?.vat_no ? `VAT no: ${company.vat_no}` : '',
  ].filter(Boolean)

  return (
    <article data-testid="document-sheet" className={clsx('mx-auto w-full max-w-[794px] rounded-sm bg-white px-5 py-6 text-[13px] leading-relaxed text-slate-800 shadow-md sm:px-12 sm:py-10', className)}>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-[3px] border-brand-500 pb-4">
        <div className="min-w-0">
          {company?.logo_url
            ? <img src={company.logo_url} alt={company?.name ?? ''} className="max-h-14 max-w-[190px] object-contain" />
            : <p className="text-lg font-extrabold tracking-tight text-slate-900">{company?.name || 'Urban Haus Construction'}</p>}
        </div>
        <div className="min-w-0 text-right text-[11px] leading-snug text-slate-500">
          {company?.name && <p className="text-xs font-semibold text-slate-800">{company.name}</p>}
          {lines.map((l) => <p key={l} className="break-words">{l}</p>)}
        </div>
      </header>

      <div className="mt-6 break-words">
        {blocks.map((b, i) => {
          if (b.type === 'gap') return <div key={i} className="h-3" />
          if (b.type === 'h1' || b.type === 'h2') {
            return b.type === 'h1'
              ? <h1 key={i} className="mt-2 mb-1 text-lg font-bold tracking-tight text-slate-900">{b.text}</h1>
              : <h2 key={i} className="mt-3 mb-0.5 text-sm font-bold text-slate-900">{b.text}</h2>
          }
          const content = b.runs.map((r, j) => (
            <Fragment key={j}>{r.bold ? <strong className="font-semibold text-slate-900"><Gaps text={r.text} /></strong> : <Gaps text={r.text} />}</Fragment>
          ))
          if (b.type === 'li') return <p key={i} className="flex gap-2 pl-1"><span aria-hidden className="text-slate-400">•</span><span className="min-w-0">{content}</span></p>
          return <p key={i}>{content}</p>
        })}
      </div>

      {signed ? (
        <section className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-4" data-testid="sheet-signed">
          <p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">Signed electronically</p>
          <img src={signed.png} alt={`Signature of ${signed.name}`} className="mt-2 max-h-20 max-w-[260px]" />
          <div className="mt-1 w-64 max-w-full border-t border-slate-400" />
          <p className="mt-1 text-xs font-semibold text-slate-800">{signed.name}</p>
          <p className="text-[11px] text-slate-500">{new Date(signed.at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' })}</p>
        </section>
      ) : signable ? (
        <section className="mt-10 grid gap-8 sm:grid-cols-2">
          {[clientName ? `For the client: ${clientName}` : 'For the client', `For ${company?.name || 'the company'}`].map((who) => (
            <div key={who}>
              <div className="h-10 border-b border-slate-400" />
              <p className="mt-1 text-[11px] text-slate-500">Signature · {who}</p>
              <div className="mt-6 h-px bg-slate-400" />
              <p className="mt-1 text-[11px] text-slate-500">Name and date</p>
            </div>
          ))}
        </section>
      ) : null}
    </article>
  )
}

/** A gap left for a field Remus could not fill, shown so nobody sends it unnoticed. */
function Gaps({ text }: { text: string }) {
  if (!text.includes(GAP)) return <>{text}</>
  const parts = text.split(GAP)
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {p}
          {i < parts.length - 1 && <mark className="rounded bg-amber-100 px-1 text-amber-800" title="Not filled in: type it in the document">{GAP}</mark>}
        </Fragment>
      ))}
    </>
  )
}
