import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Check, Download, Loader2, ShieldCheck } from 'lucide-react'
import { SignaturePad } from '../../components/ui/SignaturePad'
import { DocumentSheet } from '../../components/documents/DocumentSheet'
import { openSigning, showFile, signerPdf, submitSignature, type SigningDocument } from '../../lib/documentsApi'
import { longDate } from '../../lib/documentTemplates'

/**
 * SIGNING A DOCUMENT ONLINE, WITHOUT SIGNING IN (Remus · Handover 8). Copied from Raptor's
 * src/pages/sign/SignPage.tsx and adapted: the link's token is the authority; the client reads the document on
 * the company's letterhead, types their name, draws their signature and ticks that they agree. Stephan, 7 Nov:
 * "Online signing ... you can build it, and if other people are going to use it, you can try that."
 *
 * Kept from Raptor: the document scrolls in its own box so the signing controls are always within reach; the
 * name AND the drawing are both asked for (the drawing is the mark, the name identifies); "It can only be signed
 * once", and a second press is told so in a sentence rather than shown an error.
 * Different: Raptor's initials pad is left out (no page initials on a builder's document), and there are no
 * blanks for the signer to fill in -- the office fills every gap before it is sent.
 */
export default function SignPage() {
  const { token = '' } = useParams()
  const [doc, setDoc] = useState<SigningDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [name, setName] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await openSigning(token)
      setDoc(d)
      setMissing(d === null)
      if (d?.signerName) setName((n) => n || d.signerName || '')
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (doc) document.title = `${doc.title} · ${doc.company.name}`
  }, [doc])

  async function submit() {
    setProblem(null)
    if (name.trim().length < 2) return setProblem('Type your full name before signing.')
    if (!signature) return setProblem('Sign in the box before submitting.')
    if (!agreed) return setProblem('Tick the box to confirm that you have read the document and agree to it.')
    setBusy(true)
    try {
      await submitSignature({ token, name: name.trim(), signature, agreed })
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      await load()
    }
  }

  async function pdf() {
    setPdfBusy(true)
    setProblem(null)
    try {
      showFile(await signerPdf(token))
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    } finally {
      setPdfBusy(false)
    }
  }

  if (loading && !doc) {
    return <Shell><p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" /> Opening the document…</p></Shell>
  }
  if (missing || !doc) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-slate-800">No document here</h1>
        <p className="mt-2 text-sm text-slate-500">
          This link is not one we can open. Check that it was copied whole (they are long, and mail programs sometimes cut them), or ask us to send it again.
        </p>
        {problem && <p className="mt-3 text-sm text-red-600">{problem}</p>}
      </Shell>
    )
  }

  const signed = doc.state === 'signed' && doc.signaturePng && doc.signedName && doc.signedAt
    ? { name: doc.signedName, at: doc.signedAt, png: doc.signaturePng } : null

  return (
    <Shell wide>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-[0.1em] text-brand-700 uppercase">{doc.company.name}</p>
          <h1 className="text-lg font-semibold break-words text-slate-800">{doc.title}</h1>
          {!doc.closed && <p className="mt-0.5 text-xs text-slate-500">{doc.signerName ? `For ${doc.signerName} · ` : ''}Open until {longDate(doc.expiresAt.slice(0, 10))}</p>}
        </div>
        <button type="button" onClick={() => void pdf()} disabled={pdfBusy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {pdfBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {signed ? 'Signed copy (PDF)' : doc.source === 'quote' ? 'The full quotation (PDF)' : 'PDF'}
        </button>
      </div>

      <div className="mb-5 max-h-[65vh] overflow-auto rounded-xl bg-slate-200/70 p-2 sm:p-4" data-testid="sign-document">
        <DocumentSheet
          company={{ name: doc.company.name, address: doc.company.address, phone: doc.company.phone, email: doc.company.email, reg_no: doc.company.regNo, vat_no: doc.company.vatNo, logo_url: doc.company.logoUrl }}
          body={doc.body}
          signed={signed}
        />
      </div>

      {doc.closed ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4" data-testid="sign-closed">
          <p className="flex items-start gap-2 text-sm text-slate-700">
            <Check size={16} className="mt-0.5 shrink-0 text-emerald-600" />
            <span>
              {doc.closed}
              {signed && <span className="mt-1 block text-xs text-slate-500">Signed by {signed.name} on {new Date(signed.at).toLocaleDateString('en-ZA')}. A copy was emailed to you where we have your address.</span>}
            </span>
          </p>
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" data-testid="sign-form">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Your full name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="As it appears on your ID" autoComplete="name"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" data-testid="sign-name" />
            <span className="mt-1 block text-[11px] text-slate-400">Typed, so the document says who signed it as well as carrying your signature.</span>
          </label>
          <SignaturePad label="Your signature" onChange={setSignature} />
          <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700 select-none">
            <input type="checkbox" className="mt-1 shrink-0" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} data-testid="sign-agree" />
            <span>I have read this document, I agree to it, and I intend the signature above to be my signature on it.</span>
          </label>
          {problem && <p className="text-sm text-red-600" role="alert">{problem}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void submit()} disabled={busy} data-testid="sign-submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              {busy ? 'Signing…' : 'Sign this document'}
            </button>
            <span className="text-[11px] text-slate-400">It can only be signed once. We record your name, the time and your internet address with it.</span>
          </div>
        </div>
      )}
    </Shell>
  )
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className={wide ? 'mx-auto max-w-3xl' : 'mx-auto max-w-lg'}>{children}</div>
    </div>
  )
}
