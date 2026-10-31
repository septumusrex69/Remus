import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { useEffect, useMemo } from 'react'

/**
 * THE SITES ON A DARK MAP (Remus · Handover 6), after the fleet map Stephan sent. OpenStreetMap's tiles turned black
 * and silver (ops.css), and each site a PIN that stands out (Stephan: "the jobs that are running ... I can't see the
 * little dots. So have them pop out"): a bright core in the job's budget colour with a white ring, a soft glow, a
 * slow pulse for a running job, and its code written beside it. Booked jobs are smaller and quieter. Its own file so
 * Leaflet loads only on the Operations page.
 */
export interface OpsPoint { id: string; lat: number; lon: number; name: string; code: string | null; running: boolean; colour: string }

function Fit({ points, selected }: { points: OpsPoint[]; selected: string | null }) {
  const map = useMap()
  useEffect(() => {
    const s = points.find((p) => p.id === selected)
    if (s) { map.flyTo([s.lat, s.lon], Math.max(map.getZoom(), 13), { duration: 0.8 }); return }
    if (points.length === 1) map.setView([points[0].lat, points[0].lon], 13)
    else if (points.length > 1) map.fitBounds(points.map((p) => [p.lat, p.lon] as [number, number]), { padding: [70, 70] })
  }, [map, points, selected])
  return null
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function pin(p: OpsPoint, selected: boolean): L.DivIcon {
  const cls = ['ops-pin', p.running ? 'is-running' : 'is-booked', selected ? 'is-selected' : ''].join(' ')
  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    html: `<div class="${cls}" style="--pin:${p.colour}"><span class="ops-pin-pulse"></span><span class="ops-pin-dot"></span><span class="ops-pin-label">${esc(p.code || p.name)}</span></div>`,
  })
}

export default function OpsMap({ points, selected, onSelect }: { points: OpsPoint[]; selected: string | null; onSelect: (id: string) => void }) {
  const icons = useMemo(() => new Map(points.map((p) => [p.id, pin(p, p.id === selected)])), [points, selected])
  return (
    <MapContainer center={[-25.75, 28.23]} zoom={11} zoomControl={false} scrollWheelZoom className="h-full w-full" style={{ background: '#0b0c0e', zIndex: 0 }}>
      {/* OpenStreetMap's own tiles (the ones Find prices' map already uses), turned dark silver by ops.css. */}
      <TileLayer
        className="ops-tiles"
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <Fit points={points} selected={selected} />
      {/* Booked first, so the running jobs sit on top where they overlap. */}
      {[...points].sort((a, b) => Number(a.running) - Number(b.running)).map((p) => (
        <Marker key={p.id} position={[p.lat, p.lon]} icon={icons.get(p.id)!} zIndexOffset={p.id === selected ? 1000 : p.running ? 500 : 0}
          eventHandlers={{ click: () => onSelect(p.id) }}>
          <Tooltip direction="top" offset={[0, -18]}>{p.name}</Tooltip>
        </Marker>
      ))}
    </MapContainer>
  )
}
