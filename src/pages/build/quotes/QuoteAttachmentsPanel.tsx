import { useEffect, useRef, useState, type DragEvent } from 'react'
import { ArrowDown, ArrowUp, FileText, ImagePlus, Star, Trash2, Upload } from 'lucide-react'
import { deleteQuoteAttachment, quoteAttachments, signedUrls, uploadQuoteAttachment } from '../../../lib/api'
import { QUOTE_FILES_BUCKET } from '../../../lib/supabase'
import { labelize } from '../../../lib/format'
import { Badge, Card } from '../../../components/ui'
import { ATTACHMENT_KINDS, type AttachmentKind, type QuoteAttachment } from '../../../types'

/** Same limit as api/quotes/send.ts: attachments over this can't go out by email. */
const MAX_EMAIL_BYTES = 20 * 1024 * 1024

/** HEIC/HEIF (iPhone photos) don't render in most browsers, so they can't go in the print gallery. */
const isHeic = (mime: string | null) => /^image\/hei[cf]/i.test(mime ?? '')

/**
 * Renders, photos and documents designed outside the app. Images marked "show on quote" appear
 * in the printable quote's gallery and, with documents marked "send to client", are what
 * "Send to client" attaches; anything else stays internal. One PDF can be marked as the client
 * version, which is attached on its own instead.
 */
export function QuoteAttachmentsPanel({
  quoteId,
  attachments,
  onChange,
}: {
  quoteId: string
  attachments: QuoteAttachment[]
  onChange: (a: QuoteAttachment[]) => void
}) {
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const pathsKey = attachments.map((a) => a.file_path).join('|')
  useEffect(() => {
    const imgs = attachments.filter((a) => a.mime_type?.startsWith('image/') && !isHeic(a.mime_type)).map((a) => a.file_path)
    signedUrls(QUOTE_FILES_BUCKET, imgs).then(setUrls).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey])

  async function upload(files: FileList | File[]) {
    setError(null)
    setWarning(null)
    const list = Array.from(files).filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf')
    if (list.length === 0) return setError('Only images and PDFs can be attached.')
    const big = list.filter((f) => f.size > MAX_EMAIL_BYTES)
    if (big.length) {
      setWarning(`${big.map((f) => f.name).join(', ')} ${big.length === 1 ? 'is' : 'are'} over 20 MB and can't be emailed with "Send to client". Upload a smaller PDF to send it, or send it another way.`)
    }
    setUploading(list.length)
    let current = [...attachments]
    for (const f of list) {
      try {
        const nextOrder = current.reduce((m, x) => Math.max(m, x.sort_order), -1) + 1
        const a = await uploadQuoteAttachment(quoteId, f, nextOrder)
        current = [...current, a]
        onChange(current)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
      setUploading((n) => n - 1)
    }
  }

  async function patch(a: QuoteAttachment, p: Partial<QuoteAttachment>) {
    try {
      const saved = await quoteAttachments.update(a.id, p)
      onChange(attachments.map((x) => (x.id === a.id ? saved : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function setKind(a: QuoteAttachment, kind: AttachmentKind) {
    if (kind !== 'client_pdf') return patch(a, { kind })
    try {
      // Only one client version: demote any other.
      const others = attachments.filter((x) => x.kind === 'client_pdf' && x.id !== a.id)
      await Promise.all(others.map((x) => quoteAttachments.update(x.id, { kind: 'document' })))
      const saved = await quoteAttachments.update(a.id, { kind })
      onChange(attachments.map((x) => (x.id === a.id ? saved : others.some((o) => o.id === x.id) ? { ...x, kind: 'document' } : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const j = index + dir
    if (j < 0 || j >= attachments.length) return
    const copy = [...attachments]
    ;[copy[index], copy[j]] = [copy[j], copy[index]]
    const reordered = copy.map((a, i) => ({ ...a, sort_order: i }))
    onChange(reordered)
    await Promise.all([quoteAttachments.update(reordered[index].id, { sort_order: index }), quoteAttachments.update(reordered[j].id, { sort_order: j })]).catch(
      (e) => setError(e instanceof Error ? e.message : String(e)),
    )
  }

  async function remove(a: QuoteAttachment) {
    if (!window.confirm(`Remove ${a.file_name}?`)) return
    try {
      await deleteQuoteAttachment(a)
      onChange(attachments.filter((x) => x.id !== a.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setOver(false)
    if (e.dataTransfer.files.length) void upload(e.dataTransfer.files)
  }

  return (
    <Card title="Renders, photos & documents" padded={false}>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`m-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm ${over ? 'border-amber-400 bg-amber-50' : 'border-slate-200 text-slate-500'}`}
      >
        <ImagePlus size={24} className="mb-2 text-slate-400" />
        <p>Drag images or PDFs here, or</p>
        <button className="mt-1 inline-flex items-center gap-1 font-medium text-amber-700 hover:text-amber-800" onClick={() => inputRef.current?.click()}>
          <Upload size={14} /> choose files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files)
            e.target.value = ''
          }}
        />
        {uploading > 0 && <p className="mt-2 text-xs text-slate-500">Uploading {uploading}…</p>}
      </div>
      {error && <p className="mx-4 mb-3 text-sm text-red-600">{error}</p>}
      {warning && <p className="mx-4 mb-3 text-sm text-amber-700">{warning}</p>}
      {attachments.length > 0 && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {attachments.map((a, i) => {
            const isImage = a.mime_type?.startsWith('image/')
            const heic = isHeic(a.mime_type)
            const isPdf = a.mime_type === 'application/pdf'
            return (
              <li key={a.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                  {isImage && !heic && urls.get(a.file_path) ? (
                    <img src={urls.get(a.file_path)} alt={a.caption ?? a.file_name} className="h-full w-full object-cover" />
                  ) : (
                    <FileText size={22} className="text-slate-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-800">{a.file_name}</span>
                    {a.kind === 'client_pdf' && <Badge tone="bg-amber-100 text-amber-800">Client version</Badge>}
                  </div>
                  <input
                    className="input py-1 text-xs"
                    placeholder="Caption"
                    defaultValue={a.caption ?? ''}
                    onBlur={(e) => e.target.value !== (a.caption ?? '') && patch(a, { caption: e.target.value || null })}
                  />
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <select className="rounded border border-slate-200 px-1.5 py-0.5" value={a.kind} onChange={(e) => setKind(a, e.target.value as AttachmentKind)}>
                      {ATTACHMENT_KINDS.filter((k) => k !== 'client_pdf' || isPdf).map((k) => (
                        <option key={k} value={k}>{k === 'client_pdf' ? 'Client version (PDF)' : labelize(k)}</option>
                      ))}
                    </select>
                    {a.kind !== 'client_pdf' && (
                      <label className="flex items-center gap-1" title={isImage ? 'Shown in the printed quote and attached when emailing it' : 'Attached when emailing the quote'}>
                        <input type="checkbox" checked={a.show_on_quote} onChange={(e) => patch(a, { show_on_quote: e.target.checked })} />{' '}
                        {isImage ? 'Show on quote' : 'Send to client'}
                      </label>
                    )}
                    {isPdf && (
                      <button className="inline-flex items-center gap-1 text-amber-700 hover:text-amber-800" onClick={() => setKind(a, a.kind === 'client_pdf' ? 'document' : 'client_pdf')}>
                        <Star size={12} /> {a.kind === 'client_pdf' ? 'Unmark client version' : 'Use as client version'}
                      </button>
                    )}
                  </div>
                  {heic && <p className="text-xs text-amber-700">HEIC photos can't be shown on the printed quote. Convert it to JPG and upload that instead.</p>}
                </div>
                <div className="flex gap-1 self-end sm:self-center">
                  <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100" onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={14} /></button>
                  <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100" onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={14} /></button>
                  <button className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => remove(a)} aria-label="Remove"><Trash2 size={14} /></button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
