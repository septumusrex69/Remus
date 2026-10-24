import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { formatDistanceToNowStrict } from 'date-fns'
import {
  AlertTriangle, Ban, Check, CheckSquare, ChevronDown, ExternalLink, Filter, Forward as ForwardIcon, Inbox, Link2, Loader2,
  Mail as MailIcon, Paperclip, PenLine, RefreshCw, Reply, ReplyAll, Search, ShieldAlert, Trash2, Undo2, X,
} from 'lucide-react'
import { clientLabel, contactName, loadClientDirectory, mailboxStatus, type ClientDirectory } from '../../../lib/api'
import {
  blockSender, countUnreadByTab, deleteMail, downloadMailAttachment, fetchBlockedSenders, fetchBody, fetchMail, fetchMailItem, fetchMailPictures,
  fileOnClient, forwardSubject, isSharedDomain, domainOf, markMailRead, markMailUnread, quoteBlock, replyAllTo, replySubject,
  setJunk, unblockSender, unfileFromClient, type BlockedSender, type LinkedClient, type MailFilter, type MailItem,
} from '../../../lib/mailbox'
import { fillStoredPictures, picturesLeftOut } from '../../../lib/mailPictures'
import { emailDayLabel, emailTimeLabel } from '../../../lib/emailActivity'
import { sanitizeEmailHtml } from '../../../lib/emailHtml'
import { useEmailView } from '../../../lib/emailView'
import { useUnreadMail } from '../../../lib/unreadMail'
import { useAuth } from '../../../store/AuthContext'
import { Button, Modal } from '../../../components/ui'
import { RowMenu, type RowMenuItem } from '../../../components/ui/RowMenu'
import { ReadingPane } from '../../../components/email/ReadingPane'
import { EmailViewSwitcher } from '../../../components/email/EmailViewSwitcher'
import { ComposeEmailModal } from '../../../components/email/ComposeEmailModal'
import { paths } from '../paths'

/**
 * Mail: the person's own mailbox inside Remus, ported from Raptor's src/pages/mail/MailPage.tsx.
 *
 * Raptor's shape throughout: All / Junk / Sent / Blocked tabs (a mail server's own folders, with
 * no "needs matching" queue), unread per tab, a search over the whole mailbox, a list that expands
 * in place or Outlook's reading pane, and a floating action bar on the open message. Mail from a
 * known client is filed on the client automatically; anything else can be filed by hand.
 *
 * Left out from Raptor because they are debt-collection specific: debtor files and fees, tickets,
 * leads, and calendar invites.
 *
 * Your own mail only, enforced by the database: not even an administrator reads a colleague's inbox.
 */

type Pane = MailFilter | 'blocked'
const TABS: { id: Pane; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'Your whole mailbox, junk aside' },
  { id: 'junk', label: 'Junk', hint: 'Your mail server thought this was spam' },
  { id: 'sent', label: 'Sent', hint: 'What you have sent, from Remus, Outlook or your phone' },
  { id: 'blocked', label: 'Blocked', hint: 'Senders whose mail does not reach Remus at all' },
]
const PAGE_SIZES = [25, 50, 100, 200]

/** A colour per sender, the same one every time, so the eye finds a correspondent before reading (Raptor). */
const SENDER_COLOURS = ['#1f3a5f', '#7a5230', '#3f5c3a', '#5a3a5c', '#2f5d5f', '#6b3b3b', '#3b4a6b', '#6b5a2f']
function senderColour(address: string): string {
  let hash = 0
  for (let i = 0; i < address.length; i += 1) hash = (hash * 31 + address.charCodeAt(i)) >>> 0
  return SENDER_COLOURS[hash % SENDER_COLOURS.length]
}

function Avatar({ name, color, size = 28 }: { name: string; color: string; size?: number }) {
  const initials = name.replace(/[<>"]/g, '').split(/[\s@.]+/).filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase()
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ backgroundColor: color, width: size, height: size, fontSize: size * 0.38 }} title={name}>
      {initials || '?'}
    </span>
  )
}

/** Who a row is about: the sender, or on Sent mail the person it went to. */
const who = (m: MailItem) => (m.isSent ? m.toName || m.toAddress || '(no recipient)' : m.fromName || m.fromAddress)
const whoAddress = (m: MailItem) => (m.isSent ? m.toAddress ?? '' : m.fromAddress)

function blockedBy(address: string, blocks: BlockedSender[]): BlockedSender | null {
  const a = address.toLowerCase()
  return blocks.find((b) => (b.kind === 'address' ? b.pattern === a : a.endsWith(`@${b.pattern}`))) ?? null
}

type Draft = {
  title?: string
  to?: string
  cc?: string[]
  subject?: string
  body?: string
  inReplyTo?: string | null
  companyId?: string | null
  contactId?: string | null
}

export function MailPage() {
  const { currentUser } = useAuth()
  const unreadMail = useUnreadMail()
  const [searchParams, setSearchParams] = useSearchParams()
  const [filter, setFilter] = useState<Pane>('all')
  const [view, setView] = useEmailView()
  const [unreadByTab, setUnreadByTab] = useState<Record<MailFilter, number>>({ all: 0, junk: 0, sent: 0 })
  const [unreadOnly, setUnreadOnly] = useState(false)
  // The box, and what has been asked of the database a third of a second later (one query, not six).
  const [search, setSearch] = useState('')
  const [asked, setAsked] = useState('')
  useEffect(() => {
    if (search === '') { setAsked(''); return }
    const t = setTimeout(() => setAsked(search), 300)
    return () => clearTimeout(t)
  }, [search])
  const [searchEverywhere, setSearchEverywhere] = useState(true)
  const [items, setItems] = useState<MailItem[]>([])
  const [more, setMore] = useState(false)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [blocked, setBlocked] = useState<BlockedSender[]>([])
  const [blocking, setBlocking] = useState<MailItem | null>(null)
  const [filing, setFiling] = useState<MailItem | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [bodies, setBodies] = useState<Record<string, { text: string; html: string } | null>>({})
  const [loadingBody, setLoadingBody] = useState<string | null>(null)
  const [showPictures, setShowPictures] = useState<Record<string, boolean>>({})
  const [draft, setDraft] = useState<Draft | null>(null)
  const [mailbox, setMailbox] = useState<{ connected: boolean; email: string | null; lastSyncedAt?: string | null } | null>(null)
  const [dir, setDir] = useState<ClientDirectory | null>(null)
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  // Only at lg and up: below it there is no room for two columns, so the list is the page.
  const paneShowing = filter !== 'blocked' && view === 'reading' && wide

  useEffect(() => {
    void mailboxStatus().then(setMailbox).catch(() => setMailbox({ connected: false, email: null }))
    void loadClientDirectory().then(setDir).catch(() => {})
  }, [])

  const userId = currentUser?.id
  const load = useCallback(async (toPage = 0) => {
    if (!userId || filter === 'blocked') return
    setLoading(true)
    setLoadFailed(false)
    try {
      const [res, counts] = await Promise.all([
        fetchMail({ userId, filter, search: asked, everywhere: searchEverywhere, unreadOnly, page: toPage, pageSize }),
        countUnreadByTab(userId),
      ])
      setItems(res.items)
      setMore(res.more)
      setPage(toPage)
      setUnreadByTab(counts)
      setChosen(new Set())
    } catch (e) {
      setLoadFailed(true)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [userId, filter, asked, searchEverywhere, unreadOnly, pageSize])
  useEffect(() => { void load(0) }, [load])

  const loadBlocked = useCallback(async () => {
    if (!userId) return
    setBlocked(await fetchBlockedSenders(userId).catch(() => []))
  }, [userId])
  useEffect(() => { void loadBlocked() }, [loadBlocked])

  // A sync that filed new mail (the Sync button, the envelope) refreshes the list.
  const wasSyncing = useRef(unreadMail.syncing)
  useEffect(() => {
    if (wasSyncing.current && !unreadMail.syncing) {
      void load(page)
      void mailboxStatus().then(setMailbox).catch(() => {})
    }
    wasSyncing.current = unreadMail.syncing
  }, [unreadMail.syncing, load, page])

  const openMessage = useCallback(async (m: MailItem) => {
    setOpen(m.id)
    if (!m.readAt && userId) {
      setItems((list) => list.map((x) => (x.id === m.id ? { ...x, readAt: new Date().toISOString() } : x)))
      void markMailRead(userId, [m]).catch(() => {})
    }
    if (!(m.id in bodies)) {
      setLoadingBody(m.id)
      const stored = await fetchBody(m.id).catch(() => null)
      // The logos out of the picture store, before the email is shown (it is a few kB, fetched once a visit).
      const body = stored ? { ...stored, html: await fillStoredPictures(stored.html).catch(() => stored.html) } : null
      setBodies((b) => ({ ...b, [m.id]: body }))
      setLoadingBody(null)
      /*
       * AND ANY PICTURE THE STORE DID NOT HAVE, from the mailbox (Raptor's way): never saved, or
       * deleted after 30 days unused. The mailbox read saves it, so this happens once. Silent if the
       * mailbox can't be reached: the message is already readable.
       */
      if (body && picturesLeftOut(body.html)) {
        const html = await fetchMailPictures(m.id).catch(() => null)
        if (html) setBodies((b) => ({ ...b, [m.id]: { text: body.text, html } }))
      }
    }
  }, [bodies, userId])

  // ?message=<id> (the envelope in the top bar): open that message, then drop it from the address.
  const wanted = searchParams.get('message')
  useEffect(() => {
    if (!wanted || !userId) return
    void (async () => {
      const m = items.find((x) => x.id === wanted) ?? (await fetchMailItem(userId, wanted).catch(() => null))
      if (m) {
        if (!items.some((x) => x.id === m.id)) setItems((list) => [m, ...list])
        await openMessage(m)
      }
      setSearchParams((p) => { p.delete('message'); return p }, { replace: true })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, userId])
  // ?new=1 ("+ Add → New email" in the top bar).
  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    setDraft({})
    setSearchParams((p) => { p.delete('new'); return p }, { replace: true })
  }, [searchParams, setSearchParams])

  function bodyText(m: MailItem): string {
    const b = bodies[m.id]
    if (b?.text) return b.text
    if (b?.html) return b.html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
    return m.snippet ?? ''
  }

  const mine = [mailbox?.email, currentUser?.email]
  function reply(m: MailItem, all: boolean) {
    const base = {
      subject: replySubject(m.subject),
      body: quoteBlock(m, bodyText(m), 'reply'),
      inReplyTo: m.messageId,
      companyId: m.linkedCompanyId,
      contactId: m.linkedContactId,
    }
    if (all) {
      const r = replyAllTo(m, mine)
      setDraft({ ...base, title: 'Reply all', to: r.to || (m.isSent ? m.toAddress ?? '' : m.fromAddress), cc: r.cc })
    } else {
      setDraft({ ...base, title: 'Reply', to: m.isSent ? m.toAddress ?? '' : m.fromAddress })
    }
  }
  function forward(m: MailItem) {
    setDraft({ title: 'Forward', to: '', subject: forwardSubject(m.subject), body: quoteBlock(m, bodyText(m), 'forward') })
  }

  async function act(fn: () => Promise<unknown>, done?: string) {
    setError(null)
    setStatus(null)
    try {
      await fn()
      if (done) setStatus(done)
      await load(page)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const chosenItems = items.filter((m) => chosen.has(m.id))
  const allChosen = items.length > 0 && chosen.size === items.length
  const unread = filter === 'blocked' ? 0 : unreadByTab[filter]
  const tabLabel = TABS.find((t) => t.id === filter)?.label ?? 'this tab'

  function linkedLabel(m: MailItem): { label: string; to: string } | null {
    if (!dir || (!m.linkedCompanyId && !m.linkedContactId)) return null
    const label = clientLabel(dir, { company_id: m.linkedCompanyId, contact_id: m.linkedContactId })
    const to = m.linkedCompanyId ? paths.company(m.linkedCompanyId) : paths.contact(m.linkedContactId!)
    return { label, to }
  }

  function detail(m: MailItem, sticky: boolean) {
    return (
      <MailBody
        mail={m}
        sticky={sticky}
        body={bodies[m.id]}
        loadingBody={loadingBody === m.id}
        showPictures={!!showPictures[m.id]}
        onShowPictures={() => setShowPictures((s) => ({ ...s, [m.id]: true }))}
        linked={linkedLabel(m)}
        blockedSender={blockedBy(m.fromAddress, blocked)}
        mine={mine}
        onReply={() => reply(m, false)}
        onReplyAll={() => reply(m, true)}
        onForward={() => forward(m)}
        onUnread={() => userId && act(async () => { await markMailUnread(userId, [m]); setOpen(null) })}
        onJunk={(junk) => act(() => setJunk([m.id], junk), junk ? 'Moved to Junk.' : 'Moved back to your mailbox.')}
        onFile={() => setFiling(m)}
        onUnfile={() => userId && act(() => unfileFromClient(userId, m), 'Taken off the client.')}
        onBlock={() => setBlocking(m)}
        onDelete={() => act(async () => { await deleteMail([m.id]); setOpen(null) }, 'Deleted from Remus. It is still in your mailbox.')}
        onAttachment={(name) => downloadMailAttachment(m.id, name)}
      />
    )
  }

  const searchBar = (
    <MailSearchBar search={search} onSearch={setSearch} unreadOnly={unreadOnly} onUnreadOnly={setUnreadOnly} unread={unread}
      everywhere={searchEverywhere} onEverywhere={setSearchEverywhere} tabLabel={tabLabel} />
  )

  return (
    <div className={paneShowing ? 'flex h-[calc(100dvh-8.5rem)] min-h-[32rem] flex-col' : undefined}>
      {/* A plain card rather than <Card>: the reading pane has to be a direct flex child to fill the height. */}
      <section className={`card overflow-hidden ${paneShowing ? 'flex min-h-0 flex-1 flex-col' : ''}`}>
        {/* The mailbox, named, and the one button that writes something (Raptor). */}
        <div className="border-b border-slate-100 px-5 pt-4 pb-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex min-w-0 items-baseline gap-2.5">
              <h2 className="shrink-0 text-lg font-semibold text-slate-900">Mail</h2>
              <span className="truncate text-sm text-slate-400">{mailbox?.email ?? currentUser?.email ?? ''}</span>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <button
                onClick={() => setDraft({})}
                disabled={mailbox?.connected === false}
                title={mailbox?.connected === false ? 'Connect your mailbox in Settings first' : undefined}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-600 disabled:opacity-50"
              >
                <PenLine size={14} /> New email
              </button>
              {mailbox?.lastSyncedAt && (
                <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">
                  Checked {formatDistanceToNowStrict(new Date(mailbox.lastSyncedAt), { addSuffix: true })}
                </span>
              )}
              <button
                onClick={() => void unreadMail.sync()}
                disabled={unreadMail.syncing || mailbox?.connected === false}
                aria-label="Check for new mail now"
                title={unreadMail.syncing ? 'Checking your mailbox…' : 'Check for new mail now'}
                className="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-slate-500 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50"
              >
                {unreadMail.syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              </button>
            </div>
          </div>
        </div>

        {mailbox && !mailbox.connected && (
          <div className="flex flex-col gap-2 border-b border-slate-100 bg-brand-50/50 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">Connect your mailbox to read and send your mail here.</p>
            <Link to={paths.settings()} className="text-sm font-medium text-brand-700 hover:underline">Go to Settings →</Link>
          </div>
        )}

        {/* The tabs (unread per tab), with Select and the view switcher at the end of the row. */}
        <div className="flex items-center gap-2 border-b border-slate-200 pr-5">
          <div className="-mb-px flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-5">
            {TABS.map((t) => {
              const n = t.id === 'blocked' ? 0 : unreadByTab[t.id]
              return (
                <button
                  key={t.id}
                  onClick={() => { setFilter(t.id); setOpen(null) }}
                  title={t.hint}
                  aria-pressed={filter === t.id}
                  className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2 text-sm font-medium ${filter === t.id ? 'border-brand-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                  {t.label}
                  {n > 0 && (
                    <span title="Unread" className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-semibold text-white tabular-nums">
                      {n > 99 ? '99+' : n}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div className="flex shrink-0 items-center gap-2 py-1.5">
            {filter !== 'blocked' && items.length > 0 && (
              <button
                onClick={() => { setSelecting((s) => !s); setChosen(new Set()) }}
                aria-pressed={selecting}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${selecting ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-200 text-slate-600 hover:border-brand-300 hover:bg-brand-50'}`}
              >
                {selecting ? <X size={14} /> : <CheckSquare size={14} />}
                {selecting ? 'Done' : 'Select'}
              </button>
            )}
            {filter !== 'blocked' && <EmailViewSwitcher view={view} onChange={setView} />}
          </div>
        </div>

        {/* The bulk bar, only once something is selected. Blocking is never a bulk action (Raptor). */}
        {chosen.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-brand-100 bg-brand-50 px-5 py-2.5 text-sm">
            <span className="mr-auto font-medium text-slate-800">{chosen.size} selected</span>
            {chosenItems.some((m) => !m.readAt) && userId && (
              <button onClick={() => act(() => markMailRead(userId, chosenItems))} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-white">
                <Check size={14} /> Mark read
              </button>
            )}
            {chosenItems.some((m) => !!m.readAt) && userId && (
              <button onClick={() => act(() => markMailUnread(userId, chosenItems))} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-white">
                <MailIcon size={14} /> Mark unread
              </button>
            )}
            {filter === 'junk' ? (
              <button onClick={() => act(() => setJunk([...chosen], false))} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-white">
                <Undo2 size={14} /> Not junk
              </button>
            ) : filter === 'all' ? (
              <button onClick={() => act(() => setJunk([...chosen], true))} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-white">
                <ShieldAlert size={14} /> Move to junk
              </button>
            ) : null}
            <button
              onClick={() => window.confirm(`Delete ${chosen.size} message${chosen.size === 1 ? '' : 's'} from Remus? They stay in your mailbox, and anything filed on a client stays on the client.`) && act(() => deleteMail([...chosen]))}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-red-700 hover:bg-white"
            >
              <Trash2 size={14} /> Delete from Remus
            </button>
          </div>
        )}

        {unreadMail.syncError && mailbox?.connected !== false && (
          <p className="border-b border-slate-100 bg-red-50/50 px-5 py-2 text-[13px] text-red-700">Couldn't check your mailbox: {unreadMail.syncError}</p>
        )}
        {status && <p className="border-b border-slate-100 px-5 py-2 text-[13px] text-emerald-700">{status}</p>}
        {error && <p className="border-b border-slate-100 px-5 py-2 text-[13px] text-red-700">{error}</p>}

        {filter !== 'blocked' && !paneShowing && <div className="border-b border-slate-100">{searchBar}</div>}

        {selecting && filter !== 'blocked' && items.length > 0 && (
          <div className="border-b border-slate-100 px-5 py-2">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-500">
              <input type="checkbox" checked={allChosen} onChange={(e) => setChosen(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} />
              Select all {items.length} on this page
            </label>
          </div>
        )}

        {filter === 'blocked' ? (
          <BlockedList senders={blocked} onUnblock={async (id) => {
            await unblockSender(id)
            await loadBlocked()
            setStatus('Unblocked. Their mail appears again from the next sync, not retroactively.')
          }} />
        ) : loadFailed ? (
          <LoadFailed onRetry={() => void load(page)} />
        ) : paneShowing ? (
          <ReadingPane
            fill
            items={items}
            selectedId={open}
            onSelect={(m) => void openMessage(m)}
            emptyDetail="Pick a message on the left to read it."
            listEmpty={loading ? <div className="grid place-items-center py-14 text-slate-400"><Loader2 size={18} className="animate-spin" /></div> : <Empty filter={filter} searching={!!asked.trim()} />}
            listHeader={searchBar}
            renderLead={(m) => (
              <span className={selecting ? 'shrink-0 pt-2.5 pl-4' : ''}>
                {selecting && <input type="checkbox" checked={chosen.has(m.id)} onChange={(e) => setChosen((prev) => { const next = new Set(prev); if (e.target.checked) next.add(m.id); else next.delete(m.id); return next })} aria-label={`Select the email from ${m.fromAddress}`} />}
              </span>
            )}
            renderRow={(m) => (
              <span className={`block py-2.5 pr-3 pl-3 ${!m.readAt ? 'bg-brand-50/60' : ''}`}>
                <MailSummary mail={m} tight linked={linkedLabel(m)} blocked={blocked} />
              </span>
            )}
            renderDetail={(m) => <div className="flex min-h-full flex-col px-5 py-4">{detail(m, true)}</div>}
          />
        ) : loading && items.length === 0 ? (
          <div className="grid place-items-center py-14 text-slate-400"><Loader2 size={18} className="animate-spin" /></div>
        ) : items.length === 0 ? (
          <Empty filter={filter} searching={!!asked.trim()} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((m) => (
              <li key={m.id} className={open === m.id ? 'bg-slate-50/70' : ''}>
                <div className="flex items-center gap-3 px-4">
                  {selecting && (
                    <input type="checkbox" checked={chosen.has(m.id)} onChange={(e) => setChosen((prev) => { const next = new Set(prev); if (e.target.checked) next.add(m.id); else next.delete(m.id); return next })} aria-label={`Select the email from ${m.fromAddress}`} />
                  )}
                  <button onClick={() => (open === m.id ? setOpen(null) : void openMessage(m))} className={`min-w-0 flex-1 py-2.5 text-left ${!m.readAt ? '' : ''}`} aria-expanded={open === m.id}>
                    <MailSummary mail={m} linked={linkedLabel(m)} blocked={blocked} />
                  </button>
                </div>
                {open === m.id && <div className="px-5 pt-1 pb-4 sm:pl-12">{detail(m, false)}</div>}
              </li>
            ))}
          </ul>
        )}

        {filter !== 'blocked' && (page > 0 || more || items.length > 0) && (
          <div className={`flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500 ${paneShowing ? 'shrink-0' : ''}`}>
            <span className="inline-flex items-center gap-1.5">
              Show
              {PAGE_SIZES.map((n) => (
                <button key={n} onClick={() => setPageSize(n)} className={`rounded-full px-2 py-0.5 ${pageSize === n ? 'bg-ink-950 text-white' : 'hover:bg-slate-100'}`}>{n}</button>
              ))}
            </span>
            <span className="inline-flex items-center gap-2">
              <span>Page {page + 1}</span>
              <Button size="sm" variant="ghost" disabled={page === 0 || loading} onClick={() => void load(page - 1)}>Newer</Button>
              <Button size="sm" variant="ghost" disabled={!more || loading} onClick={() => void load(page + 1)}>Older</Button>
            </span>
          </div>
        )}
      </section>

      {draft && (
        <ComposeEmailModal
          open
          title={draft.title}
          to={draft.to}
          cc={draft.cc}
          recipients={dir ? [
            ...dir.companies.filter((c) => c.email).map((c) => ({ email: c.email!, label: c.name })),
            ...dir.contacts.filter((c) => c.email).map((c) => ({ email: c.email!, label: contactName(c) })),
          ] : undefined}
          initialSubject={draft.subject}
          initialBody={draft.body}
          inReplyTo={draft.inReplyTo}
          companyId={draft.companyId ?? null}
          contactId={draft.contactId ?? null}
          onClose={() => setDraft(null)}
          onSent={() => { setStatus('Sent. A copy is in your Sent folder.'); void unreadMail.sync() }}
        />
      )}
      {blocking && userId && (
        <BlockModal mail={blocking} onClose={() => setBlocking(null)} onBlock={async (kind) => {
          const n = await blockSender({ userId, address: blocking.fromAddress, kind, label: blocking.fromName })
          setBlocking(null)
          setOpen(null)
          await loadBlocked()
          await load(page)
          setStatus(`Blocked. ${n} message${n === 1 ? '' : 's'} removed from Remus; nothing more from them will arrive here.`)
        }} />
      )}
      {filing && userId && dir && (
        <FileModal mail={filing} dir={dir} onClose={() => setFiling(null)} onFile={async (client) => {
          const companyIdOfContact = client.kind === 'contact' ? dir.contactById.get(client.id)?.company_id ?? null : null
          await fileOnClient({ userId, mail: filing, body: bodyText(filing), client, companyIdOfContact })
          setFiling(null)
          await load(page)
          setStatus('Filed on the client. The whole team sees it on the client’s Emails card.')
        }} />
      )}
    </div>
  )
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="py-14 text-center">
      <AlertTriangle size={22} className="mx-auto text-brand-600" />
      <p className="mt-3 text-sm font-medium text-slate-700">Your mailbox could not be loaded.</p>
      <p className="mt-1 text-[13px] text-slate-500">This is not an empty mailbox: nothing was read, so nothing is missing. The reason is in the red line above.</p>
      <button onClick={onRetry} className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
        <RefreshCw size={13} /> Try again
      </button>
    </div>
  )
}

function Empty({ filter, searching }: { filter: MailFilter; searching: boolean }) {
  if (searching) return <p className="py-14 text-center text-sm text-slate-400">Nothing matches that.</p>
  const words: Record<MailFilter, string> = {
    all: 'Your mailbox is empty here. Connect it under Settings → My email, then press the refresh button.',
    junk: 'Nothing in junk.',
    sent: 'Nothing sent yet. This fills from your mailbox’s Sent folder, so mail you send from Outlook or your phone shows here too.',
  }
  return (
    <div className="py-14 text-center">
      <Inbox size={22} className="mx-auto text-slate-300" />
      <p className="mx-auto mt-3 max-w-md px-4 text-sm text-slate-500">{words[filter]}</p>
    </div>
  )
}

/** Searching the mailbox, and narrowing it to unread (Raptor's MailSearchBar). */
function MailSearchBar({ search, onSearch, unreadOnly, onUnreadOnly, unread, everywhere, onEverywhere, tabLabel }: {
  search: string
  onSearch: (value: string) => void
  unreadOnly: boolean
  onUnreadOnly: (on: boolean) => void
  unread: number
  everywhere: boolean
  onEverywhere: (on: boolean) => void
  tabLabel: string
}) {
  return (
    <div className="space-y-1.5 px-4 py-3">
      <div className="flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search mail…" aria-label="Search your mailbox"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pr-3 pl-9 text-sm placeholder:text-slate-400 focus:ring-2 focus:ring-brand-100 focus:outline-none" />
        </label>
        <div className="relative shrink-0">
          <Filter size={13} aria-hidden className={`pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 ${unreadOnly ? 'text-brand-700' : 'text-slate-400'}`} />
          <select value={unreadOnly ? 'unread' : 'all'} onChange={(e) => onUnreadOnly(e.target.value === 'unread')} aria-label="Narrow this list"
            className={`cursor-pointer appearance-none rounded-lg border py-2 pr-7 pl-7 text-sm font-medium focus:ring-2 focus:ring-brand-100 focus:outline-none ${unreadOnly ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600'}`}>
            <option value="all">All mail</option>
            <option value="unread">{unread > 0 ? `Unread only · ${unread}` : 'Unread only'}</option>
          </select>
          <ChevronDown size={13} aria-hidden className={`pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 ${unreadOnly ? 'text-brand-700' : 'text-slate-400'}`} />
        </div>
      </div>
      {search.trim() !== '' && (
        <p className="text-[11px] text-slate-400">
          {everywhere ? 'Searching the whole mailbox, junk and sent included.' : `Searching ${tabLabel} only.`}{' '}
          <button type="button" onClick={() => onEverywhere(!everywhere)} className="font-medium text-slate-500 underline underline-offset-2 hover:text-slate-800">
            {everywhere ? `Search ${tabLabel} only` : 'Search everywhere'}
          </button>
        </p>
      )}
    </div>
  )
}

/** What has happened to this message, on its row: on a client, junk, or a blocked sender. */
function MailStatus({ mail, linked, blocked, tight }: { mail: MailItem; linked: { label: string } | null; blocked: BlockedSender[]; tight?: boolean }) {
  const chip = 'shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap'
  const block = !mail.isSent && blockedBy(mail.fromAddress, blocked)
  return (
    <>
      {linked ? (
        <span className={`${chip} max-w-[14rem] bg-emerald-50 text-emerald-700`} title={`Filed on ${linked.label}`}>
          <Link2 size={10} className="shrink-0" />
          <span className="truncate">{tight ? 'Client' : linked.label}</span>
        </span>
      ) : mail.isJunk ? (
        <span className={`${chip} bg-slate-100 text-slate-500`}><ShieldAlert size={10} /> Junk</span>
      ) : null}
      {block && <span className={`${chip} bg-red-50 text-red-700`}><Ban size={10} /> {tight ? 'Blocked' : 'Sender blocked'}</span>}
    </>
  )
}

/** Who, then what about, then what it says (Raptor's MailSummary): stacked in the pane, one line in the list. */
function MailSummary({ mail, tight, linked, blocked }: { mail: MailItem; tight?: boolean; linked: { label: string } | null; blocked: BlockedSender[] }) {
  const unread = !mail.readAt && !mail.isSent
  const name = who(mail)
  const avatar = (
    <span className="relative inline-flex shrink-0">
      <Avatar name={name} color={senderColour(whoAddress(mail) || name)} size={tight ? 32 : 24} />
      {unread && <span aria-hidden title="Unread" className={`absolute -top-0.5 -right-0.5 rounded-full bg-brand-500 ring-2 ring-white ${tight ? 'h-2.5 w-2.5' : 'h-2 w-2'}`} />}
    </span>
  )
  if (tight) {
    return (
      <span className="flex min-w-0 items-start gap-3">
        {avatar}
        <span className="block min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={`truncate text-sm ${unread ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>{mail.isSent ? `To ${name}` : name}</span>
            <span className="ml-auto shrink-0 text-xs text-slate-400">{emailDayLabel(mail.occurredAt)}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            <span className={`truncate text-[13px] ${unread ? 'text-slate-700' : 'text-slate-500'}`}>{mail.subject || '(no subject)'}</span>
            {mail.attachmentNames.length > 0 && <Paperclip size={12} className="shrink-0 text-slate-400" />}
            <span className="ml-auto flex items-center gap-1.5"><MailStatus mail={mail} linked={linked} blocked={blocked} tight /></span>
          </span>
          {mail.snippet && <span className="mt-0.5 block truncate text-[13px] text-slate-400">{mail.snippet}</span>}
        </span>
      </span>
    )
  }
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {avatar}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-[13px] sm:flex-row sm:items-center sm:gap-2 sm:whitespace-nowrap">
        <span className={`truncate sm:w-56 sm:shrink-0 ${unread ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`} title={whoAddress(mail)}>
          {mail.isSent ? `To ${name}` : name}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className={unread ? 'font-medium text-slate-800' : 'text-slate-600'}>{mail.subject || '(no subject)'}</span>
          {mail.snippet && <span className="hidden text-slate-400 sm:inline"> · {mail.snippet}</span>}
        </span>
      </span>
      {mail.attachmentNames.length > 0 && <Paperclip size={12} className="shrink-0 text-slate-400" />}
      <span className="hidden sm:contents"><MailStatus mail={mail} linked={linked} blocked={blocked} /></span>
      <span className="min-w-[4.5rem] shrink-0 text-right text-[12px] text-slate-400 tabular-nums">{emailDayLabel(mail.occurredAt)}</span>
    </span>
  )
}

/**
 * A message's own markup, on screen, with nothing of the message reaching the page (Raptor's
 * EmailFrame): a sandboxed frame with no scripts and a content policy that fetches nothing.
 */
function EmailFrame({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement | null>(null)
  const [height, setHeight] = useState(0)
  const measure = useCallback(() => {
    const doc = frame.current?.contentDocument
    if (!doc?.body) return
    const wanted = Math.max(doc.body.scrollHeight, doc.documentElement?.scrollHeight ?? 0)
    setHeight(Math.min(Math.max(wanted + 2, 48), 3200))
  }, [])
  useEffect(() => {
    setHeight(0)
    const later = setTimeout(measure, 400)
    return () => clearTimeout(later)
  }, [html, measure])
  return (
    <iframe ref={frame} title="Message" srcDoc={html} onLoad={measure} referrerPolicy="no-referrer"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="block w-full border-0 bg-white" style={{ height: `${height || 48}px` }} />
  )
}

/** Everything you can do with an open message (Raptor's MessageActions): floating in the pane, a row in the list. */
function MessageActions({ mail, sticky, linked, moreActions, onReply, onReplyAll, onForward, onUnread }: {
  mail: MailItem
  sticky: boolean
  linked: { label: string; to: string } | null
  moreActions: RowMenuItem[]
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
  onUnread: () => void
}) {
  const others = mail.toRecipients.length + mail.ccRecipients.length > 1
  return (
    <div className={sticky ? 'pointer-events-none sticky bottom-3 z-20 mt-auto flex justify-center pt-4' : 'flex flex-wrap items-center gap-1.5 pb-2'}>
      <div className={sticky ? 'pointer-events-auto inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white/95 px-1.5 py-1 shadow-lg backdrop-blur' : 'contents'}>
        {!mail.isSent && <BarButton sticky={sticky} onClick={onUnread} label="Mark unread" icon={<MailIcon size={15} />} />}
        {others && <BarButton sticky={sticky} onClick={onReplyAll} label="Reply all" icon={<ReplyAll size={15} />} />}
        <BarButton sticky={sticky} onClick={onForward} label="Forward" icon={<ForwardIcon size={15} />} />
        {linked && (
          <Link to={linked.to} title={`Open ${linked.label}`} aria-label={`Open ${linked.label}`}
            className={sticky ? 'inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800' : 'inline-flex max-w-[15rem] min-w-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800'}>
            <ExternalLink size={15} className="shrink-0" />
            {!sticky && <span className="truncate">Open {linked.label}</span>}
          </Link>
        )}
        {moreActions.length > 0 && (
          <div className={sticky ? '' : 'ml-auto'}>
            <RowMenu width="w-56" bordered={!sticky} up={sticky} label="More things to do with this message" items={moreActions} />
          </div>
        )}
        {sticky && <span aria-hidden className="mx-1 h-5 w-px bg-slate-200" />}
        <button onClick={onReply} className={`inline-flex items-center gap-1.5 bg-brand-500 font-medium text-white hover:bg-brand-600 ${sticky ? 'rounded-full px-3.5 py-1.5 text-[13px]' : 'rounded-lg px-3 py-1.5 text-[13px]'}`}>
          <Reply size={15} /> Reply
        </button>
      </div>
    </div>
  )
}

function BarButton({ sticky, onClick, label, icon }: { sticky: boolean; onClick: () => void; label: string; icon: ReactNode }) {
  return (
    <button onClick={onClick} title={label} aria-label={label}
      className={sticky ? 'inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800' : 'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50'}>
      {icon}
      {!sticky && label}
    </button>
  )
}

function MailBody({ mail, sticky, body, loadingBody, showPictures, onShowPictures, linked, blockedSender, mine, onReply, onReplyAll, onForward, onUnread, onJunk, onFile, onUnfile, onBlock, onDelete, onAttachment }: {
  mail: MailItem
  sticky: boolean
  body: { text: string; html: string } | null | undefined
  loadingBody: boolean
  showPictures: boolean
  onShowPictures: () => void
  linked: { label: string; to: string } | null
  blockedSender: BlockedSender | null
  mine: (string | null | undefined)[]
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
  onUnread: () => void
  onJunk: (junk: boolean) => void
  onFile: () => void
  onUnfile: () => void
  onBlock: () => void
  onDelete: () => void
  onAttachment: (name: string) => Promise<void>
}) {
  const safe = useMemo(() => (body?.html?.trim() ? sanitizeEmailHtml(body.html, { showPictures }) : null), [body, showPictures])
  const [downloading, setDownloading] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  const moreActions: RowMenuItem[] = [
    { label: linked ? 'File on another client' : 'File on a client', icon: <Link2 size={15} />, onClick: onFile },
    ...(linked ? [{ label: 'Take off the client', icon: <Undo2 size={15} />, onClick: onUnfile }] : []),
    ...(!mail.isSent
      ? [mail.isJunk
        ? { label: 'Not junk', icon: <Undo2 size={15} />, onClick: () => onJunk(false) }
        : { label: 'Move to junk', icon: <ShieldAlert size={15} />, onClick: () => onJunk(true) }]
      : []),
    { label: 'Delete from Remus', icon: <Trash2 size={15} />, onClick: onDelete },
    ...(!mail.isSent && !blockedSender ? [{ label: 'Block sender', icon: <Ban size={15} />, onClick: onBlock, danger: true }] : []),
  ]
  const bar = { mail, sticky, linked, moreActions, onReply, onReplyAll, onForward, onUnread }
  const me = new Set(mine.filter((x): x is string => !!x).map((x) => x.toLowerCase()))
  const line = (label: string, list: { name: string | null; address: string }[]) =>
    list.length > 0 && (
      <p className="mt-0.5 text-xs text-slate-500">
        <span className="text-slate-400">{label} </span>
        {list.map((r, i) => (
          <span key={r.address}>{i > 0 && ', '}{me.has(r.address.toLowerCase()) ? 'me' : r.name ? `${r.name} <${r.address}>` : r.address}</span>
        ))}
      </p>
    )

  return (
    <>
      {sticky && (
        <div className="flex items-start gap-3">
          <h3 className="min-w-0 flex-1 text-base font-semibold text-balance text-slate-900">{mail.subject || '(no subject)'}</h3>
          <span className="shrink-0 pt-1 text-xs whitespace-nowrap text-slate-400">{emailDayLabel(mail.occurredAt)} <span className="tabular-nums">{emailTimeLabel(mail.occurredAt)}</span></span>
        </div>
      )}
      {!sticky && <MessageActions {...bar} />}
      <div className={`flex items-start gap-3 border-b border-slate-100 pb-3 ${sticky ? 'mt-3 mb-3' : 'mb-3'}`}>
        <Avatar name={mail.fromName || mail.fromAddress} color={senderColour(mail.fromAddress)} size={40} />
        <div className="min-w-0 flex-1">
          <p className="min-w-0 text-sm">
            <span className="font-semibold text-slate-900">{mail.fromName || mail.fromAddress}</span>
            {mail.fromName && <span className="break-words text-slate-400"> &lt;{mail.fromAddress}&gt;</span>}
          </p>
          {line('To', mail.toRecipients)}
          {line('Cc', mail.ccRecipients)}
          {!sticky && <p className="mt-0.5 text-xs text-slate-400">{emailDayLabel(mail.occurredAt)} at {emailTimeLabel(mail.occurredAt)}</p>}
        </div>
      </div>
      {mail.attachmentNames.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pb-3">
          <Paperclip size={11} className="text-slate-400" />
          {mail.attachmentNames.map((name) => (
            <button key={name} disabled={downloading === name} title="Download from your mailbox"
              onClick={async () => { setDownloading(name); setFileError(null); try { await onAttachment(name) } catch (e) { setFileError(e instanceof Error ? e.message : String(e)) } finally { setDownloading(null) } }}
              className="inline-flex max-w-[280px] items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:border-brand-300 hover:text-brand-700 disabled:opacity-50">
              <span className="truncate">{name}</span>
              {downloading === name && <Loader2 size={11} className="animate-spin" />}
            </button>
          ))}
          {fileError && <span className="text-xs text-red-600">{fileError}</span>}
        </div>
      )}
      {loadingBody && <p className="inline-flex items-center gap-1.5 text-[13px] text-slate-400"><Loader2 size={13} className="animate-spin" /> Opening the message…</p>}
      {!loadingBody && safe && (
        <>
          {safe.blockedRemote > 0 && !showPictures && (
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">Pictures in this message were not downloaded, so the sender cannot tell you opened it.</p>
              <button type="button" onClick={onShowPictures} className="text-xs font-medium text-emerald-700 hover:underline">Show pictures</button>
            </div>
          )}
          <EmailFrame html={safe.html} />
        </>
      )}
      {!loadingBody && body && !safe && (
        <p className="text-sm break-words whitespace-pre-wrap text-slate-700">{body.text.trim() || <span className="text-slate-400">This message has no text in it.</span>}</p>
      )}
      {!loadingBody && body === null && (
        <>
          {mail.snippet && <p className="text-sm break-words whitespace-pre-wrap text-slate-700">{mail.snippet}</p>}
          <p className="mt-2 text-xs text-brand-700">This message was too large to keep in Remus. Showing its first lines; open it in your mail app for the rest.</p>
        </>
      )}
      {sticky && <MessageActions {...bar} />}
    </>
  )
}

function BlockedList({ senders, onUnblock }: { senders: BlockedSender[]; onUnblock: (id: string) => Promise<void> }) {
  if (senders.length === 0) {
    return (
      <div className="py-14 text-center">
        <Ban size={22} className="mx-auto text-slate-300" />
        <p className="mx-auto mt-3 max-w-md px-4 text-sm text-slate-500">Nobody is blocked. Block a sender from an open message's menu, and nothing more from them reaches Remus.</p>
      </div>
    )
  }
  return (
    <ul className="divide-y divide-slate-100">
      {senders.map((b) => (
        <li key={b.id} className="flex items-center gap-3 px-5 py-3">
          <Ban size={15} className="shrink-0 text-red-600" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-slate-800">{b.kind === 'domain' ? `Everyone at ${b.pattern}` : b.pattern}</span>
            {b.label && <span className="block truncate text-xs text-slate-400">{b.label}</span>}
          </span>
          <Button size="sm" onClick={() => void onUnblock(b.id)}>Unblock</Button>
        </li>
      ))}
    </ul>
  )
}

/** One sender at a time, never in bulk (Raptor): blocking stops every future message, silently. */
function BlockModal({ mail, onClose, onBlock }: { mail: MailItem; onClose: () => void; onBlock: (kind: 'address' | 'domain') => Promise<void> }) {
  const domain = domainOf(mail.fromAddress)
  const shared = isSharedDomain(mail.fromAddress)
  const [kind, setKind] = useState<'address' | 'domain'>('address')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal open onClose={onClose} title="Block sender" footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); setError(null); try { await onBlock(kind) } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false) } }}>
        <Ban size={14} /> Block
      </Button>
    </>}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">Nothing more from this sender will reach Remus, and what they have already sent is removed from it. Their mail still arrives in your mailbox itself.</p>
        <label className="flex items-start gap-2"><input type="radio" checked={kind === 'address'} onChange={() => setKind('address')} className="mt-1" /> <span>Just <b>{mail.fromAddress}</b></span></label>
        {domain && !shared && (
          <label className="flex items-start gap-2"><input type="radio" checked={kind === 'domain'} onChange={() => setKind('domain')} className="mt-1" /> <span>Everyone at <b>{domain}</b></span></label>
        )}
        {shared && <p className="text-xs text-slate-400">{domain} is shared by millions of people, so only this address can be blocked.</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}

/** File a message on a client by hand: search companies and people. */
function FileModal({ mail, dir, onClose, onFile }: { mail: MailItem; dir: ClientDirectory; onClose: () => void; onFile: (client: LinkedClient) => Promise<void> }) {
  const [q, setQ] = useState(() => (mail.isSent ? mail.toAddress : mail.fromAddress) ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const results = useMemo(() => {
    const t = q.trim().toLowerCase()
    const has = (...xs: (string | null | undefined)[]) => !t || xs.some((x) => x?.toLowerCase().includes(t))
    const companies = dir.companies.filter((c) => has(c.name, c.email)).map((c) => ({ kind: 'company' as const, id: c.id, label: c.name, sub: c.email ?? 'Company' }))
    const people = dir.contacts.filter((c) => has(contactName(c), c.email)).map((c) => ({
      kind: 'contact' as const, id: c.id, label: contactName(c), sub: [c.company_id ? dir.companyById.get(c.company_id)?.name : 'Private client', c.email].filter(Boolean).join(' · '),
    }))
    const exact = [...people, ...companies]
    // Nothing matched the address: show everyone, so a new correspondent can still be filed.
    return (exact.length ? exact : [
      ...dir.contacts.map((c) => ({ kind: 'contact' as const, id: c.id, label: contactName(c), sub: c.email ?? '' })),
      ...dir.companies.map((c) => ({ kind: 'company' as const, id: c.id, label: c.name, sub: c.email ?? '' })),
    ]).slice(0, 40)
  }, [q, dir])
  return (
    <Modal open onClose={onClose} title="File on a client">
      <div className="space-y-3">
        <p className="text-sm text-slate-500">The message joins the client's Emails card, where the whole team can see it.</p>
        <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients and people…" />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100">
          {results.map((r) => (
            <li key={`${r.kind}-${r.id}`}>
              <button disabled={!!busy} onClick={async () => { setBusy(r.id); setError(null); try { await onFile({ kind: r.kind, id: r.id }) } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(null) } }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-50">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-800">{r.label}</span>
                  <span className="block truncate text-xs text-slate-400">{r.sub}</span>
                </span>
                {busy === r.id ? <Loader2 size={14} className="animate-spin text-slate-400" /> : <span className="shrink-0 text-xs text-slate-400">{r.kind === 'company' ? 'Company' : 'Person'}</span>}
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-400">No clients yet. Add one under Clients first.</li>}
        </ul>
      </div>
    </Modal>
  )
}
