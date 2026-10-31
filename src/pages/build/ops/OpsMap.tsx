import 'leaflet/dist/leaflet.css'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { useEffect } from 'react'

/**
 * THE SITES ON A DARK MAP (Remus · Handover 6), after the fleet map Stephan sent. CARTO's dark OpenStreetMap tiles
 * (free, credited), each site a glowing dot in its budget colour, the chosen one ringed in hi-vis. Its own file so
 * Leaflet loads only on the Operations page.
 */
export interface OpsPoint { id: string; lat: number; lon: number; name: string; colour: string }

function Fit({ points, selected }: { points: OpsPoint[]; selected: string | null }) {
  const map = useMap()
  useEffect(() => {
    const s = points.find((p) => p.id === selected)
    if (s) { map.flyTo([s.lat, s.lon], Math.max(map.getZoom(), 13), { duration: 0.8 }); return }
    if (points.length === 1) map.setView([points[0].lat, points[0].lon], 13)
    else if (points.length > 1) map.fitBounds(points.map((p) => [p.lat, p.lon] as [number, number]), { padding: [60, 60] })
  }, [map, points, selected])
  return null
}

export default function OpsMap({ points, selected, onSelect }: { points: OpsPoint[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <MapContainer center={[-25.75, 28.23]} zoom={11} zoomControl={false} scrollWheelZoom className="h-full w-full" style={{ background: '#0b0c0e', zIndex: 0 }}>
      <TileLayer
        url="https://{s}.basemap.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
      />
      <Fit points={points} selected={selected} />
      {points.map((p) => (
        <CircleMarker key={`halo-${p.id}`} center={[p.lat, p.lon]} radius={p.id === selected ? 26 : 16} interactive={false}
          pathOptions={{ stroke: false, fillColor: p.id === selected ? '#d4f24a' : p.colour, fillOpacity: p.id === selected ? 0.18 : 0.12 }} />
      ))}
      {points.map((p) => (
        <CircleMarker key={p.id} center={[p.lat, p.lon]} radius={p.id === selected ? 9 : 7}
          eventHandlers={{ click: () => onSelect(p.id) }}
          pathOptions={{ color: p.id === selected ? '#d4f24a' : '#0b0c0e', weight: 3, fillColor: p.colour, fillOpacity: 1 }}>
          <Tooltip direction="top" offset={[0, -8]}>{p.name}</Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
