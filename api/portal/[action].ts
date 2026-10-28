import handler from '../_lib/portal.js'

/**
 * THE CLIENT PORTAL (Remus · Handoff 5, Raptor H13): its own function, because it is a different kind of
 * caller -- a client, never staff -- and keeping its door separate keeps its rules in one file
 * (api/_lib/portal.ts).
 */
export default handler
