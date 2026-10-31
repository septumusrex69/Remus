import { Link } from 'react-router-dom'
import { Camera, ChevronRight, FileText } from 'lucide-react'
import { PHOTO_PLACES, photoFor, photoUrl } from '../../../lib/brandPhotos'
import { PageHeader } from '../../../components/ui'
import { BudgetBar } from '../components/BudgetBar'
import { useBuild } from '../BuildContext'
import { paths } from '../paths'

/**
 * THE PLATINUM BRAND BOARD (Remus · Handover 6). Stephan: "build out the brand board a little bit better with the
 * stuff that goes with platinum" and "make it unique compared to Raptor". Drawn from the same tokens as the app
 * (skins.css), so what is on the board is what the screens wear.
 */
const METALS = [
  { name: 'Obsidian', hex: '#0b0b0d', use: 'The frame, the photo bands' },
  { name: 'Graphite', hex: '#16171a', use: 'Headings on light, dark panels' },
  { name: 'Gunmetal', hex: '#2b2d32', use: 'Buttons, corner ticks' },
  { name: 'Storm', hex: '#4a4d54', use: 'Body text' },
  { name: 'Pewter', hex: '#8b9098', use: 'Quiet text, planned work' },
  { name: 'Silver', hex: '#c4c8cf', use: 'Hairlines on dark, the Snap slip button' },
  { name: 'Mist', hex: '#e4e6e9', use: 'Hairlines on light, tracks' },
  { name: 'Bone', hex: '#f1f1ef', use: 'The page' },
  { name: 'Snow', hex: '#ffffff', use: 'Cards' },
]
const SIGNALS = [
  { name: 'Steel', hex: '#5a7282', use: 'On track, paid, progress' },
  { name: 'Brass', hex: '#a8843f', use: 'Getting close, waiting on someone' },
  { name: 'Ember', hex: '#a33a30', use: 'Late, over budget' },
]

function Swatch({ name, hex, use, dark }: { name: string; hex: string; use: string; dark?: boolean }) {
  return (
    <div className="card overflow-hidden">
      <div className="h-20" style={{ backgroundColor: hex, boxShadow: hex === '#ffffff' ? 'inset 0 -1px 0 #e4e6e9' : undefined }} />
      <div className="p-3">
        <p className="skin-eyebrow text-[10px] font-semibold text-slate-500">{name}</p>
        <p className="font-mono text-sm text-slate-900">{hex}</p>
        <p className={`mt-0.5 text-xs ${dark ? 'text-slate-600' : 'text-slate-500'}`}>{use}</p>
      </div>
    </div>
  )
}

function Label({ children }: { children: string }) {
  return (
    <div className="mt-8 mb-3 flex items-center gap-3">
      <span className="skin-eyebrow text-[11px] font-semibold text-slate-600">{children}</span>
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  )
}

export function BrandBoardPage() {
  const { settings } = useBuild()
  const band = photoFor('band', settings?.brand_photos)
  return (
    <div>
      <PageHeader title="Brand board" subtitle="Platinum: black glass, brushed silver, white light. Square corners and drawing marks, so Remus is its own." />

      <section className="skin-band relative overflow-hidden rounded-2xl bg-ink-950 px-8 py-10 text-white"
        style={{ backgroundImage: `linear-gradient(100deg, rgba(9,9,11,0.92) 0%, rgba(9,9,11,0.6) 55%, rgba(9,9,11,0.3) 100%), url('${photoUrl(band, 2000)}')`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <img src="/brand/remus-wordmark-white.png" alt="Remus" className="relative z-[1] h-10 w-auto" />
        <p className="skin-eyebrow relative z-[1] mt-3 text-[11px] text-white/60">Construction management</p>
        <p className="relative z-[1] mt-6 max-w-lg text-2xl font-light leading-snug">Built square. Measured twice.</p>
      </section>

      <Label>The metals</Label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {METALS.map((m) => <Swatch key={m.name} {...m} />)}
      </div>

      <Label>The signals (no green, no traffic lights)</Label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {SIGNALS.map((m) => <Swatch key={m.name} {...m} dark />)}
      </div>
      <div className="card mt-3 grid gap-4 p-4 sm:grid-cols-3">
        <div><p className="mb-1 text-xs text-slate-500">On track</p><BudgetBar score={{ costPct: 52, timePct: 60, tone: 'good' }} /></div>
        <div><p className="mb-1 text-xs text-slate-500">Getting close</p><BudgetBar score={{ costPct: 81, timePct: 70, tone: 'good' }} /></div>
        <div><p className="mb-1 text-xs text-slate-500">Nearly at the end</p><BudgetBar score={{ costPct: 96, timePct: 80, tone: 'warn' }} /></div>
      </div>

      <Label>Shape</Label>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card p-5">
          <p className="text-sm font-semibold text-slate-900">Square, with drawing marks</p>
          <p className="mt-1 text-sm text-slate-600">Every card has 2px corners, a hairline edge, no soft shadow, and a draughtsman's tick at each corner, as on a construction drawing. Raptor is rounded and soft; Remus is cut square.</p>
        </div>
        <div className="card p-5">
          <p className="text-sm font-semibold text-slate-900">Buttons</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white"><FileText size={15} /> New quote</button>
            <span className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-[#111214]" style={{ backgroundImage: 'linear-gradient(180deg,#f6f6f4 0%,#c4c8cf 100%)' }}><Camera size={15} /> Snap slip</span>
            <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-700">Cancel</button>
          </div>
        </div>
      </div>

      <Label>Type</Label>
      <div className="card p-5">
        <p className="skin-eyebrow text-[11px] font-semibold text-slate-500">Section label · tracked capitals</p>
        <p className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">Good afternoon, Stephan</p>
        <p className="mt-1 text-sm text-slate-600">Inter throughout. Headings heavy and tight, words plain, figures in even columns: <span className="tabular font-semibold text-slate-900">R 374 218.00</span></p>
      </div>

      <Label>Photographs · black and white, tools and work, no faces</Label>
      <div className="grid gap-3 sm:grid-cols-3">
        {PHOTO_PLACES.map((pl) => {
          const p = photoFor(pl.id, settings?.brand_photos)
          return (
            <div key={pl.id} className="card overflow-hidden">
              <div className="h-32 bg-ink-950 bg-cover bg-center" style={{ backgroundImage: `url('${photoUrl(p, 800)}')` }} />
              <div className="p-3 text-sm"><span className="font-semibold text-slate-800">{pl.label}:</span> <span className="text-slate-600">{p.subject}</span></div>
            </div>
          )
        })}
      </div>
      <Link to={paths.photos()} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">Choose the photographs <ChevronRight size={14} /></Link>
    </div>
  )
}
