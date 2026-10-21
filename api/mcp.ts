import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { buildServer, hashToken } from './_lib/mcpTools.js'

/**
 * Remus as a remote MCP server ("Claude connector"), so a person's own Claude can look things up,
 * file slips and draft quotes.
 *
 * URL: https://<app>/api/mcp. Auth: a personal access token from Settings → Claude connector, as
 * `Authorization: Bearer remus_…` (Claude Code, API) or `?key=remus_…` in the URL (claude.ai custom
 * connectors, which cannot send headers without OAuth). Stateless: each POST builds a fresh server.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET' || req.method === 'DELETE') {
    // Stateless server: no SSE stream to resume and no session to end.
    return res.status(405).setHeader('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null })
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const url = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return res.status(501).json({ jsonrpc: '2.0', error: { code: -32000, message: 'The Remus connector is not set up: SUPABASE_SERVICE_ROLE_KEY is missing on the server.' }, id: null })
  }

  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : typeof req.query.key === 'string' ? req.query.key.trim() : ''
  if (!token.startsWith('remus_')) {
    return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Missing or invalid Remus access token.' }, id: null })
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: tok } = await admin.from('api_tokens').select('id, user_id, revoked_at').eq('token_hash', hashToken(token)).maybeSingle()
  if (!tok || tok.revoked_at) {
    return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'This Remus access token is not valid (revoked or unknown).' }, id: null })
  }
  const { data: profile } = await admin.from('profiles').select('id, name, role, status').eq('id', tok.user_id).maybeSingle()
  if (!profile || profile.status !== 'Active') {
    return res.status(403).json({ jsonrpc: '2.0', error: { code: -32001, message: 'This Remus account is deactivated.' }, id: null })
  }
  void admin.from('api_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', tok.id).then(() => {})

  const server = buildServer(admin, { id: profile.id, name: profile.name, canWrite: profile.role !== 'Read Only' })
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (e) {
    console.error('MCP request failed', e)
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null })
  }
}
