import 'leaflet/dist/leaflet.css'
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet'
import type { NearbyBranch, NearbyCentre } from '../../../lib/api'

/**
 * THE MAP OF WHERE A QUOTE SHOPS (Remus · Handoff 1). OpenStreetMap tiles, the quote's areas as circles,
 * each branch as a dot in its chain's colour. Circle markers rather than pin images: Leaflet's pins need
 * image files a bundler loses, and a dot reads just as well at this size.
 *
 * Its own file so it loads only when a map is opened (QuoteEditor imports it lazily).
 */
const CHAIN_COLOUR: Record<string, string> = {
  builders: '#f2c200', leroymerlin: '#78be20', cashbuild: '#d0121b', buco: '#004b8d', plumblink: '#1d4890', buildit: '#e3001b',
}

export default function ShopMap({ centres, branches }: { centres: NearbyCentre[]; branches: NearbyBranch[] }) {
  if (!centres.length) return null
  const lats = centres.map((c) => c.lat)
  const lons = centres.map((c) => c.lon)
  const pad = Math.max(...centres.map((c) => c.radiusKm)) / 111
  const bounds: [[number, number], [number, number]] = [[Math.min(...lats) - pad, Math.min(...lons) - pad], [Math.max(...lats) + pad, Math.max(...lons) + pad]]
  return (
    <MapContainer bounds={bounds} scrollWheelZoom={false} className="h-72 w-full rounded-xl" style={{ zIndex: 0 }}>
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
      {centres.map((c, i) => (
        <Circle key={`c${i}`} center={[c.lat, c.lon]} radius={c.radiusKm * 1000} pathOptions={{ color: '#454B50', weight: 1.5, fillOpacity: 0.06 }}>
          <Tooltip>{c.label}: {c.radiusKm} km</Tooltip>
        </Circle>
      ))}
      {centres.map((c, i) => (
        <CircleMarker key={`p${i}`} center={[c.lat, c.lon]} radius={6} pathOptions={{ color: '#fff', weight: 2, fillColor: '#512C35', fillOpacity: 1 }}>
          <Tooltip permanent direction="top" offset={[0, -6]}>{c.label}</Tooltip>
        </CircleMarker>
      ))}
      {branches.map((b, i) => (
        // My stores: larger, ringed in the brand's oxblood, so the ones Urban Haus uses stand out.
        <CircleMarker key={`b${i}`} center={[b.lat, b.lon]} radius={b.mine ? 9 : 7} pathOptions={{ color: b.mine ? '#512C35' : '#fff', weight: b.mine ? 3 : 2, fillColor: CHAIN_COLOUR[b.store] ?? '#64748b', fillOpacity: 1 }}>
          <Tooltip>{b.name}{b.mine ? ' (yours)' : ''} · {b.distanceKm} km from {b.nearest}</Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
