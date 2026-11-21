// Regenradar-Karte — bewusst EIGENES Modul: Leaflet + react-leaflet sind ~150 kB
// (44 kB gzip) und werden nur gebraucht, wenn jemand das Radar wirklich öffnet.
// WeatherScreen lädt dieses Modul per React.lazy — im Index-Bundle ist kein
// Leaflet mehr. Auch leaflet.css hängt hier dran, damit der Stil mit dem Chunk
// kommt und nicht breit im Haupt-CSS landet.
import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

function MapUpdater({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView([lat, lon], 7)
  }, [map, lat, lon])
  return null
}

interface WeatherMapProps {
  lat: number
  lon: number
  isDark: boolean
  radarHost: string
  /** Pfad des aktuellen Radar-Frames (RainViewer); leer → keine Radar-Ebene. */
  framePath: string
}

export default function WeatherMap({ lat, lon, isDark, radarHost, framePath }: WeatherMapProps) {
  return (
    <MapContainer
      center={[lat, lon]}
      zoom={7}
      maxZoom={7}
      style={{ height: '100%', width: '100%' }}
      zoomControl={true}
      scrollWheelZoom={true}
      dragging={true}
    >
      {/* Basiskarte bewusst keyless: CARTO verlangt seit 2026 einen
          API-Key und liefert sonst Kacheln mit „API KEY REQUIRED"
          als Hintergrund (am 26.10.2026 geprüft). OpenStreetMap
          braucht keinen Key; für den Dunkelmodus wird dieselbe
          Kachel per CSS invertiert, damit es EINEN Anbieter gibt. */}
      <TileLayer
        key={isDark ? 'base-dark' : 'base-light'}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        className={isDark ? 'wx-radar-basemap is-dark' : 'wx-radar-basemap'}
        maxNativeZoom={7}
      />
      {radarHost && framePath && (
        <TileLayer
          key={`${framePath}-${isDark ? 'd' : 'l'}`}
          url={`${radarHost}${framePath}/256/{z}/{x}/{y}/2/1.png`}
          opacity={isDark ? 0.55 : 0.65}
          maxNativeZoom={7}
        />
      )}
      <CircleMarker
        center={[lat, lon]}
        radius={10}
        pathOptions={{ color: '#F39C12', fillColor: '#F39C12', fillOpacity: 0.8, weight: 2 }}
      />
      <MapUpdater lat={lat} lon={lon} />
    </MapContainer>
  )
}
