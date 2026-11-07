/**
 * THE LIBRARY AND ONLINE SIGNING, THE DATABASE HALF (Remus · Handover 8). Kept apart from lib/api.ts so five
 * sessions working at once do not all edit one file; the same shape as api.ts (functions throw on error with a
 * plain message; pages catch and show it).
 *
 * Templates and documents are read and written as the signed-in person (the database's rules apply: only an
 * Administrator writes templates; a site manager sees no money). Signing links are MADE by the server
 * (api/portal -> api/_lib/signing.ts), because only the server holds the key their tokens are hashed with.
 */
import { supabase } from './supabase'
import type { DocKind } from './documentTemplates'
import type { SigningRequestRow } from './signingStatus'

export interface DocumentTemplate {
  id: string
  kind: DocKind
  name: string
  subject: string | null
  body: string
  signable: boolean
  active: boolean
  seed_key: string | null
  created_at: string
  updated_at: string
}

export interface ProjectDocument {
  id: string
  project_id: string | null
  company_id: string | null
  contact_id: string | null
  quote_id: string | null
  variation_id: string | null
  invoice_id: string | null
  template_id: string | null
  kind: DocKind
  title: string
  subject: string | null
  body: string
  signable: boolean
  status: 'draft' | 'sent' | 'signed' | 'cancelled'
  sent_at: string | null
  sent_to: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

function friendly(message: string): string {
  if (/row-level security/i.test(message)) return 'Only an Administrator may change the Library.'
  if (/relation .* does not exist|Could not find the table/i.test(message)) return 'The Library is not set up in the database yet (migrations 0046 and 0047).'
  return message
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(friendly(res.error.message))
  return res.data as T
}

/* ------------------------------------------------------------------ templates */

export async function listTemplates(): Promise<DocumentTemplate[]> {
  return unwrap(await supabase.from('document_templates').select('*').order('kind').order('name')) ?? []
}

export type TemplateDraft = Pick<DocumentTemplate, 'kind' | 'name' | 'subject' | 'body' | 'signable' | 'active'>

export async function saveTemplate(id: string | null, draft: TemplateDraft): Promise<DocumentTemplate> {
  const values = { ...draft, name: draft.name.trim(), subject: draft.subject?.trim() || null, updated_at: new Date().toISOString() }
  return id
    ? unwrap(await supabase.from('document_templates').update(values).eq('id', id).select('*').single())
    : unwrap(await supabase.from('document_templates').insert(values).select('*').single())
}

export async function deleteTemplate(id: string): Promise<void> {
  unwrap(await supabase.from('document_templates').delete().eq('id', id))
}

/* ------------------------------------------------------------------ documents */

export async function listDocuments(filter: { project_id?: string; company_id?: string; contact_id?: string }): Promise<ProjectDocument[]> {
  let q = supabase.from('project_documents').select('*')
  for (const [k, v] of Object.entries(filter)) if (v) q = q.eq(k, v)
  return unwrap(await q.order('created_at', { ascending: false })) ?? []
}

export type DocumentDraft = Omit<ProjectDocument, 'id' | 'created_at' | 'updated_at' | 'created_by' | 'sent_at' | 'sent_to' | 'status'> & { status?: ProjectDocument['status'] }

export async function createDocument(draft: DocumentDraft): Promise<ProjectDocument> {
  return unwrap(await supabase.from('project_documents').insert(draft).select('*').single())
}

export async function updateDocument(id: string, values: Partial<Pick<ProjectDocument, 'title' | 'subject' | 'body' | 'signable' | 'status'>>): Promise<ProjectDocument> {
  return unwrap(await supabase.from('project_documents').update({ ...values, updated_at: new Date().toISOString() }).eq('id', id).select('*').single())
}

export async function deleteDocument(id: string): Promise<void> {
  unwrap(await supabase.from('project_documents').delete().eq('id', id))
}

/* ------------------------------------------------------------------ signing requests (read as yourself) */

const SIGNING_COLUMNS = 'id, source, document_id, quote_id, variation_id, project_id, title, signer_name, signer_email, state, expires_at, opened_at, open_count, signed_at, signed_name, signed_ip, emailed_at, copy_sent_at, created_by, created_at'

export async function listSigningRequests(filter: { project_id?: string; quote_id?: string; document_id?: string }): Promise<SigningRequestRow[]> {
  let q = supabase.from('signing_requests').select(SIGNING_COLUMNS)
  for (const [k, v] of Object.entries(filter)) if (v) q = q.eq(k, v)
  const res = await q.order('created_at', { ascending: false })
  /* Before 0047 is applied the table is not there: no requests, rather than an error on every project. */
  if (res.error) return []
  return (res.data ?? []) as unknown as SigningRequestRow[]
}

/* ------------------------------------------------------------------ the server's half */

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const t = data.session?.access_token
  if (!t) throw new Error('You are signed out. Sign in again and retry.')
  return t
}

async function post(action: string, body: Record<string, unknown>, auth = true): Promise<Response> {
  try {
    return await fetch(`/api/portal/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${await token()}` } : {}) },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.")
  }
}

async function json<T>(res: Response, what: string): Promise<T> {
  const out = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(out.error ?? `Could not ${what} (HTTP ${res.status}).`)
  return out
}

async function pdfFile(res: Response): Promise<File> {
  if (!res.ok) {
    const out = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(out?.error ?? `Could not make the PDF (HTTP ${res.status}).`)
  }
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'Document.pdf'
  return new File([await res.blob()], name, { type: 'application/pdf' })
}

/** A document's PDF on the letterhead. */
export const documentPdf = async (id: string) => pdfFile(await post('doc-pdf', { id }))

/** A signing request's PDF, signed (with the signature block) once it is. */
export const signedPdf = async (id: string) => pdfFile(await post('sign-signed-pdf', { id }))

export async function emailDocument(id: string, payload: { to: string[]; cc?: string[]; subject: string; message: string }) {
  return json<{ ok: boolean; from: string; attached: string[] }>(await post('doc-send', { id, ...payload }), 'send the document')
}

export interface SigningCreated { id: string; url: string; expiresAt: string; emailed: boolean; emailError: string | null }

export async function sendForSigning(payload: {
  source: 'document' | 'quote' | 'variation'; id: string; signerName: string; signerEmail: string; days: number
  email: boolean; subject?: string; message?: string
}): Promise<SigningCreated> {
  return json<SigningCreated>(await post('sign-create', payload), 'make the signing link')
}

export async function cancelSigning(id: string): Promise<void> {
  await json(await post('sign-cancel', { id }), 'withdraw the link')
}

/* ------------------------------------------------------------------ the signer's side (no login) */

export interface SigningDocument {
  title: string
  body: string
  source: 'document' | 'quote' | 'variation'
  signerName: string | null
  state: 'sent' | 'signed' | 'cancelled'
  expiresAt: string
  /** Why it cannot be signed now (signed, withdrawn, expired), or null. */
  closed: string | null
  signedAt: string | null
  signedName: string | null
  signaturePng: string | null
  company: { name: string; address: string | null; phone: string | null; email: string | null; regNo: string | null; vatNo: string | null; logoUrl: string | null }
}

/** Null when the link is not one the server knows. */
export async function openSigning(tokenValue: string): Promise<SigningDocument | null> {
  const res = await post('sign-open', { token: tokenValue }, false)
  if (res.status === 404) return null
  return json<SigningDocument>(res, 'open the document')
}

export async function submitSignature(payload: { token: string; name: string; signature: string; agreed: boolean }): Promise<{ ok: boolean; signedAt: string }> {
  return json(await post('sign-submit', payload, false), 'save your signature')
}

export const signerPdf = async (tokenValue: string) => pdfFile(await post('sign-pdf', { token: tokenValue }, false))

/* ------------------------------------------------------------------ a PDF on the device */

/** Opens a PDF in a new tab where the browser can, else saves it. */
export function showFile(file: File, win?: Window | null) {
  const url = URL.createObjectURL(file)
  if (win) win.location.href = url
  else {
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** The share sheet with the PDF (WhatsApp on a phone), else a download -- as quotes do (lib/api.ts shareQuotePdf). */
export async function shareFile(file: File, text?: string): Promise<'shared' | 'cancelled' | 'downloaded'> {
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: file.name.replace(/\.pdf$/i, ''), ...(text ? { text } : {}) })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    }
  }
  showFile(file)
  return 'downloaded'
}
