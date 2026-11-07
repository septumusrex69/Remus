/**
 * NEWS, THE BROWSER'S HALF (Remus · Handover 8, 7 Nov 2026; Raptor's src/lib/marketingApi.ts, adapted).
 *
 * The rows an Administrator may read (RLS: news_may_send, migration 0050), and the calls to /api/portal/news-* for
 * everything that draws a list, renders the email or sends. The list is never drawn in the browser: the server
 * answers the preview with the very function it sends with.
 */
import { supabase } from './supabase'
import { compressImage } from './image'
import { signedUrls, SITE_PHOTOS_BUCKET } from './api'

export type CampaignKind = 'news' | 'invitation'

export type Audience =
  | { kind: 'all_clients' }
  | { kind: 'clients_with_jobs' }
  | { kind: 'subscribers' }
  | { kind: 'everyone' }
  | { kind: 'lists'; listIds: string[] }

/* The same words as api/_lib/newsRules.ts (the page cannot import the server's file). */
export const AUDIENCE_LABELS: Record<Audience['kind'], string> = {
  all_clients: 'All clients with an email',
  clients_with_jobs: 'Clients we have done a job for',
  subscribers: 'People who signed up',
  everyone: 'Clients and people who signed up',
  lists: 'An imported list',
}
export const INVITATION_AUDIENCES: Audience['kind'][] = ['subscribers', 'lists']
export const KIND_LABELS: Record<CampaignKind, string> = { news: 'Newsletter', invitation: 'Invitation to sign up' }
export const MERGE_FIELDS = ['first_name', 'company'] as const

export interface NewsPicture { url: string; caption?: string | null }

export interface CampaignRow {
  id: string
  name: string
  kind: CampaignKind
  subject: string
  preheader: string
  body: string
  images: NewsPicture[]
  audience: Audience
  status: 'draft' | 'sending' | 'sent' | 'cancelled'
  recipient_count: number | null
  created_by: string | null
  created_at: string
  updated_at: string
  queued_at: string | null
  queued_by: string | null
  finished_at: string | null
}

export type CampaignDraft = Pick<CampaignRow, 'name' | 'kind' | 'subject' | 'preheader' | 'body' | 'images' | 'audience'>

/** One row of marketing_campaign_results(): what Resend took, and everything its webhook reported after. */
export interface CampaignResults {
  campaign_id: string
  total: number; queued: number; accepted: number; failed: number; skipped: number
  delivered: number; delayed: number; bounced: number; complained: number
  opened: number; clicked: number; unsubscribed: number; opted_in: number
}

/**
 * THE RATES, EACH OVER WHAT COULD HAVE DONE IT (Raptor's resultRates): delivered and bounced out of what Resend took;
 * opens, clicks, unsubscribes out of what was delivered. Null, never 0%, when nothing could yet.
 */
export function resultRates(r: CampaignResults) {
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null)
  return {
    delivered: pct(r.delivered, r.accepted), bounced: pct(r.bounced, r.accepted), opened: pct(r.opened, r.delivered),
    clicked: pct(r.clicked, r.delivered), unsubscribed: pct(r.unsubscribed, r.delivered), complained: pct(r.complained, r.delivered),
    optedIn: pct(r.opted_in, r.delivered),
  }
}

export const OPENS_ARE_APPROXIMATE = 'Opens are approximate: Apple Mail opens every email it receives on the reader’s behalf, and a reader whose mail blocks pictures is never counted. Clicks are the firmer figure.'

export interface SenderConfig {
  ready: boolean; missing: string[]; problem: string | null; from: string | null; replyTo: string | null
  webhook: boolean; steps: string[]; keyProblem: string | null
}

export interface AudiencePreview {
  count: number
  sample: { email: string; firstName: string | null; companyName: string | null; via: 'company' | 'contact' | 'subscriber'; basis: string }[]
  excluded: Record<string, number>
}

export interface DrainReport { sent: number; failed: number; skipped: number; remaining: number; stoppedFor: string | null }

/* ---------------------------------------------------------------- the server */

async function call<T>(action: string, body: Record<string, unknown> = {}, signedIn = true): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (signedIn) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Error('You are signed out. Sign in again and retry.')
    headers.Authorization = `Bearer ${token}`
  }
  const res = await fetch(`/api/portal/${action}`, { method: 'POST', headers, body: JSON.stringify(body) })
  const out = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(out.error ?? 'Remus could not be reached just now. Try again in a minute.')
  return out
}

export const senderConfig = () => call<SenderConfig>('news-config')
export const previewAudience = (audience: Audience, kind: CampaignKind) => call<AudiencePreview>('news-preview', { audience, kind })
export const renderEmail = (campaign: CampaignDraft, sample?: { firstName: string | null; companyName: string | null }) =>
  call<{ subject: string; html: string; text: string; unknown: string[] }>('news-render', { campaign, sample })
export const sendTest = (campaignId: string) => call<{ sentTo: string }>('news-test', { campaignId })
export const queueCampaign = (campaignId: string) => call<DrainReport & { queued: number }>('news-queue', { campaignId })
export const drainCampaign = (campaignId: string) => call<DrainReport>('news-drain', { campaignId })
export const cancelCampaign = (campaignId: string) => call<{ cancelled: boolean }>('news-cancel', { campaignId })

export type ImportOutcome = 'new' | 'already on our list' | 'already a client' | 'bad email' | 'duplicate in file'
export const IMPORT_OUTCOMES: ImportOutcome[] = ['new', 'already on our list', 'already a client', 'bad email', 'duplicate in file']
export interface ImportPreview { counts: Record<ImportOutcome, number>; examples: Record<ImportOutcome, string[]>; rows: number }
export const previewImport = (csv: string) => call<ImportPreview>('news-import-preview', { csv })
export const importList = (csv: string, name: string, fileName: string | null, consentNote: string) =>
  call<{ id: string; written: number; withConsent: boolean }>('news-import', { csv, name, fileName, consentNote })

/* The no-login pages. */
export interface UnsubscribeState { email: string; status: 'subscribed' | 'unsubscribed' | 'undeliverable'; changedAt: string | null }
export const unsubscribeStep = (token: string, step: 'status' | 'unsubscribe' | 'resubscribe') =>
  call<UnsubscribeState>('news-unsubscribe', { token, step }, false)
export interface OptInState { email: string; optedIn: boolean }
export const optInStep = (token: string, step: 'status' | 'yes' | 'withdraw') => call<OptInState>('news-opt-in', { token, step }, false)
export const signUp = (form: { email: string; name: string; company: string; agree: boolean; website: string }) =>
  call<{ message: string }>('news-sign-up', form, false)
export const brand = () => call<{ name: string; logoUrl: string | null; phone: string | null; email: string | null }>('brand', {}, false)

/* ---------------------------------------------------------------- the rows */

const COLUMNS = 'id, name, kind, subject, preheader, body, images, audience, status, recipient_count, created_by, created_at, updated_at, queued_at, queued_by, finished_at'

export async function listCampaigns(): Promise<{ campaigns: CampaignRow[]; counts: Map<string, CampaignResults> }> {
  const [{ data, error }, { data: counts }] = await Promise.all([
    supabase.from('marketing_campaigns').select(COLUMNS).order('created_at', { ascending: false }).limit(200),
    supabase.rpc('marketing_campaign_results'),
  ])
  if (error) throw new Error(error.message)
  return {
    campaigns: (data ?? []) as unknown as CampaignRow[],
    counts: new Map(((Array.isArray(counts) ? counts : []) as CampaignResults[]).map((c) => [c.campaign_id, c])),
  }
}

export async function getCampaign(id: string): Promise<CampaignRow | null> {
  const { data, error } = await supabase.from('marketing_campaigns').select(COLUMNS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  const row = data as unknown as CampaignRow | null
  return row ? { ...row, images: Array.isArray(row.images) ? row.images : [] } : null
}

export async function createCampaign(name: string, kind: CampaignKind): Promise<CampaignRow> {
  const audience: Audience = kind === 'invitation' ? { kind: 'lists', listIds: [] } : { kind: 'all_clients' }
  const { data, error } = await supabase.from('marketing_campaigns').insert({ name, kind, audience }).select(COLUMNS).single()
  if (error) throw new Error(error.message)
  return data as unknown as CampaignRow
}

export async function saveCampaign(id: string, d: CampaignDraft): Promise<void> {
  const { error } = await supabase.from('marketing_campaigns').update({ ...d, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteDraft(id: string): Promise<void> {
  const { error } = await supabase.from('marketing_campaigns').delete().eq('id', id).eq('status', 'draft')
  if (error) throw new Error(error.message)
}

export async function campaignResults(id: string): Promise<CampaignResults | null> {
  const { data, error } = await supabase.rpc('marketing_campaign_results')
  if (error) throw new Error(error.message)
  return ((Array.isArray(data) ? data : []) as CampaignResults[]).find((c) => c.campaign_id === id) ?? null
}

export interface RecipientRow {
  id: string; email: string; first_name: string | null; company_name: string | null; basis: string | null
  state: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped' | 'bounced' | 'complained'
  error: string | null; sent_at: string | null; delivered_at: string | null; first_opened_at: string | null; open_count: number
  first_clicked_at: string | null; click_count: number; unsubscribed_at: string | null; opted_in_at: string | null
}
export const RECIPIENT_PAGE = 500

export async function campaignRecipients(id: string): Promise<RecipientRow[]> {
  const { data, error } = await supabase.from('marketing_sends')
    .select('id, email, first_name, company_name, basis, state, error, sent_at, delivered_at, first_opened_at, open_count, first_clicked_at, click_count, unsubscribed_at, opted_in_at')
    .eq('campaign_id', id).order('email').limit(RECIPIENT_PAGE)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as RecipientRow[]
}

export interface MarketingList {
  id: string; name: string; file_name: string | null; consent_note: string | null; uploaded_at: string; subscriber_count: number
}
export async function listLists(): Promise<MarketingList[]> {
  const { data, error } = await supabase.from('marketing_lists')
    .select('id, name, file_name, consent_note, uploaded_at, subscriber_count').order('uploaded_at', { ascending: false }).limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as MarketingList[]
}

export interface Subscriber {
  id: string; email: string; name: string | null; company: string | null; source: string
  consent_at: string | null; consent_how: string | null; consent_note: string | null; confirm_sent_at: string | null; created_at: string
}
export async function listSubscribers(): Promise<Subscriber[]> {
  const { data, error } = await supabase.from('marketing_subscribers')
    .select('id, email, name, company, source, consent_at, consent_how, consent_note, confirm_sent_at, created_at')
    .order('created_at', { ascending: false }).limit(1000)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Subscriber[]
}

/** Somebody said yes to us in person or on the phone: recorded as staff's, dated now, with where they said it. */
export async function addSubscriberByHand(p: { email: string; name: string; company: string; consentNote: string }, by: string): Promise<void> {
  const email = p.email.trim().toLowerCase()
  const { error } = await supabase.from('marketing_subscribers').insert({
    email, name: p.name.trim() || null, company: p.company.trim() || null, source: 'recorded by staff',
    consent_at: new Date().toISOString(), consent_how: 'recorded by staff', consent_note: p.consentNote.trim(), consent_by: by,
  })
  if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'That address is already on the list.' : error.message)
}

export async function removeSubscriber(id: string): Promise<void> {
  const { error } = await supabase.from('marketing_subscribers').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export interface Preference { email: string; status: string; how: string; reason: string | null; changed_at: string }
/** Everybody who said stop, could not be reached, or reported us as spam. */
export async function listStopped(): Promise<Preference[]> {
  const { data, error } = await supabase.from('marketing_preferences').select('email, status, how, reason, changed_at')
    .neq('status', 'subscribed').order('changed_at', { ascending: false }).limit(1000)
  if (error) throw new Error(error.message)
  return (data ?? []) as Preference[]
}

/** Somebody phoned and said stop: recorded as staff's, never as the link (Raptor). */
export async function recordStop(email: string, reason: string): Promise<void> {
  const { error } = await supabase.from('marketing_preferences')
    .upsert({ email: email.trim().toLowerCase(), status: 'unsubscribed', how: 'recorded by staff', reason: reason.trim() || null }, { onConflict: 'email' })
  if (error) throw new Error(error.message)
}

/* ---------------------------------------------------------------- photos */

export const NEWS_PICTURES_BUCKET = 'news-pictures'

/** A photo from the computer or phone, shrunk first, into the public news store (0051). */
export async function uploadNewsPicture(campaignId: string, file: File): Promise<NewsPicture> {
  const small = await compressImage(file, { maxEdge: 1600, quality: 0.82 })
  const type = /^image\/(jpeg|png|webp)$/.test(small.type) ? small.type : 'image/jpeg'
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${campaignId}/${crypto.randomUUID()}.${ext}`
  const up = await supabase.storage.from(NEWS_PICTURES_BUCKET).upload(path, small, { contentType: type })
  if (up.error) throw new Error(up.error.message)
  return { url: supabase.storage.from(NEWS_PICTURES_BUCKET).getPublicUrl(path).data.publicUrl, caption: null }
}

/** A site diary photo ticked "show the client", copied by the server into the public store. */
export const copyDiaryPhoto = (photoId: string) => call<NewsPicture>('news-diary-photo', { photoId })

export interface ClientPhoto { id: string; project: string; caption: string | null; created_at: string; url: string | null }
/** The latest site diary photos the client may see, newest first, with a short-lived link to show them here. */
export async function clientPhotos(limit = 60): Promise<ClientPhoto[]> {
  const { data, error } = await supabase.from('site_diary_photos').select('id, path, caption, created_at, project_id, projects(name)')
    .eq('show_client', true).order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as { id: string; path: string; caption: string | null; created_at: string; projects: { name: string } | null }[]
  /* A photo whose link could not be made is still offered (drawn grey), rather than the whole list failing. */
  const urls = await signedUrls(SITE_PHOTOS_BUCKET, rows.map((r) => r.path)).catch(() => new Map<string, string>())
  return rows.map((r) => ({ id: r.id, project: r.projects?.name ?? '', caption: r.caption, created_at: r.created_at, url: urls.get(r.path) ?? null }))
}
