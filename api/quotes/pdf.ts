import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireCaller } from '../_lib/auth.js'
import { buildQuotePdf, QuotePdfError } from '../_lib/quotePdf.js'

/** GET /api/quotes/pdf?id=<quote id> → the quote as an A4 PDF (Authorization: Bearer <session>). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const caller = await requireCaller(req)
  if (!caller) return res.status(401).json({ error: 'Please sign in again.' })
  const id = typeof req.query.id === 'string' ? req.query.id : ''
  if (!id) return res.status(400).json({ error: 'id is required.' })
  try {
    const pdf = await buildQuotePdf(caller.db, id)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${pdf.filename}"`)
    res.setHeader('Cache-Control', 'private, no-store')
    return res.status(200).send(Buffer.from(pdf.bytes))
  } catch (e) {
    if (e instanceof QuotePdfError) return res.status(404).json({ error: e.message })
    console.error('Quote PDF failed', e)
    return res.status(500).json({ error: 'Could not build the PDF.' })
  }
}
