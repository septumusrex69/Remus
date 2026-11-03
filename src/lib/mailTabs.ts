/**
 * Which tab of the Mail page a message lives on, copied from Raptor's lib/emailRules.ts (MailFilter, TabFacts,
 * tabOf, bumpUnread) and kept apart from mailbox.ts so it can be tested without a database.
 *
 * ARCHIVE (Raptor S16, copied in Remus · Handover 8; Stephan: "The Raptor stuff, you can build in"). In Raptor,
 * Stephan of the staff: "if an email has been dealt with ... that it's archived ... they want their inboxes to show
 * that it's empty ... that's how they used to working", and then "instead of done, just say archive and just put it
 * to the right of drafts". So a person can archive a message: it leaves the Inbox for the Archive tab, and "Move to
 * inbox" puts it back. The id stays 'done' and the column `done_at`, as in Raptor, because nothing a person sees
 * reads them.
 */

/*
 * The tabs that hold mail. 'all' is labelled Inbox (Stephan in Raptor, 30 Oct: "instead of all, say inbox"); the id
 * stays 'all'. 'done' is labelled Archive. A message is on exactly one of the four (tabOf).
 */
export type MailFilter = 'all' | 'done' | 'junk' | 'sent'

export interface TabFacts {
  isSent: boolean
  isJunk: boolean
  /* REQUIRED, not optional (Raptor S16). Optional would let a caller that forgot it read every archived message as
     Inbox. */
  doneAt: string | null
}

/**
 * The one tab a message lives on: sent, junk, archive or the inbox, in the order the database query (mailbox.ts
 * scope) writes them. Archive comes AFTER junk and sent: it is the inbox's other half, so only mail that would
 * otherwise be in the Inbox can be in it. Junk somebody once archived is still junk.
 */
export function tabOf(mail: TabFacts): MailFilter {
  if (mail.isSent) return 'sent'
  if (mail.isJunk) return 'junk'
  if (mail.doneAt) return 'done'
  return 'all'
}

/**
 * Whether a message can be archived (Raptor's canBeDone): only one in the Inbox or already archived. Junk is a shelf
 * of its own and sent mail is not waiting on anybody, so neither has an inbox to leave.
 */
export const canBeArchived = (mail: Pick<TabFacts, 'isJunk' | 'isSent'>): boolean => !mail.isJunk && !mail.isSent

/**
 * Moves one message's unread count on the tab it belongs to, without asking the database (Raptor's bumpUnread):
 * archiving an unread message takes one off the Inbox, moving it back puts one on.
 */
export function bumpUnread(counts: Record<MailFilter, number>, mail: TabFacts, by: number): Record<MailFilter, number> {
  const tab = tabOf(mail)
  return { ...counts, [tab]: Math.max(0, counts[tab] + by) }
}

/** The line that says where the mail went (Raptor's wording, S16 30 Oct). */
export function archivedMessage(count: number, archived: boolean, one = false): string {
  if (one) {
    return archived
      ? 'Archived — out of your inbox. It is under Archive, where Move to inbox puts it back.'
      : 'Moved back to your inbox.'
  }
  const emails = `${count} ${count === 1 ? 'email' : 'emails'}`
  return archived
    ? `${emails} archived — under Archive, where Move to inbox puts them back.`
    : `${emails} back in your inbox.`
}
