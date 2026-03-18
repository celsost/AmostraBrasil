import React, { useEffect, useState, useCallback } from 'react'
import { MapContainer, Marker, Popup, GeoJSON, useMap } from 'react-leaflet'
import L from 'leaflet'
import './MapView.css'

// Fix default marker icon in Vite/React (Leaflet uses file paths that break with bundlers)
if (typeof L !== 'undefined' && L.Icon && L.Icon.Default && L.Icon.Default.prototype) {
  delete L.Icon.Default.prototype._getIconUrl
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  })
}

const BRAZIL_CENTER = [-14.24, -51.93]
const DEFAULT_ZOOM = 4

function FitBounds({ points, limitesGeoJson }) {
  const map = useMap()
  useEffect(() => {
    if (!map) return

    // Prefer ajustar aos limites do município; se não houver, usa os pontos.
    if (limitesGeoJson && limitesGeoJson.features && limitesGeoJson.features.length > 0) {
      const layer = L.geoJSON(limitesGeoJson)
      const bounds = layer.getBounds()
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 })
        return
      }
    }

    if (points && points.length > 0) {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]))
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 })
    }
  }, [map, points, limitesGeoJson])
  return null
}

const LIMITES_STYLE = {
  color: '#0d47a1',
  weight: 2,
  fillColor: '#1565c0',
  fillOpacity: 0.15,
}

// Style for extra layer (parks, forests, lakes) — by tipo
const EXTRA_LAYER_COLORS = {
  parque: '#2e7d32',
  bosque: '#1b5e20',
  mata: '#004d40',
  lago: '#0277bd',
}
const EXTRA_LAYER_DEFAULT = '#388e3c'

export default function MapView({ points, municipio, source, limitesGeoJson, extraLayerGeoJson }) {
  const [mapReady, setMapReady] = useState(false)
  const hasPoints = points && points.length > 0
  const hasLimites = limitesGeoJson && limitesGeoJson.features && limitesGeoJson.features.length > 0
  const hasExtraLayer = extraLayerGeoJson && extraLayerGeoJson.features && extraLayerGeoJson.features.length > 0

  const extraLayerStyle = useCallback((feature) => {
    const t = (feature?.properties?.tipo || '').toLowerCase()
    const fill = EXTRA_LAYER_COLORS[t] || EXTRA_LAYER_DEFAULT
    return {
      color: fill,
      weight: 1.5,
      fillColor: fill,
      fillOpacity: 0.35,
    }
  }, [])

  const onEachExtraFeature = useCallback((feature, layer) => {
    const props = feature?.properties
    if (props && (props.nome || props.tipo)) {
      const name = props.nome || props.tipo || 'Área verde'
      layer.bindPopup(`<strong>${name}</strong>${props.tipo ? `<br/><span>Tipo: ${props.tipo}</span>` : ''}`)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setMapReady(true), 100)
    return () => clearTimeout(t)
  }, [])

  if (!mapReady) {
    return (
      <div className="map-view map-view-loading">
        <div className="map-placeholder">Carregando mapa…</div>
      </div>
    )
  }

  return (
    <div className="map-view">
      <MapContainer
        center={BRAZIL_CENTER}
        zoom={DEFAULT_ZOOM}
        className="map-container"
        scrollWheelZoom
        style={{ height: '100%', width: '100%', backgroundColor: '#f5f5f5' }}
      >
        {hasLimites && (
          <GeoJSON data={limitesGeoJson} style={LIMITES_STYLE} />
        )}
        {hasExtraLayer && (
          <GeoJSON
            data={extraLayerGeoJson}
            style={extraLayerStyle}
            onEachFeature={onEachExtraFeature}
          />
        )}
        {hasPoints &&
          points.map((p, i) => (
            <Marker key={i} position={[p.lat, p.lng]}>
              <Popup>
                <strong>{p.endIBGE || `Ponto ${i + 1}`}</strong>
                {p.tipo && <><br /><span>Tipo: {p.tipo}</span></>}
                {p.setor && <><br /><span>Setor: {p.setor}</span></>}
              </Popup>
            </Marker>
          ))}
        {(hasPoints || hasLimites) && (
          <FitBounds points={points} limitesGeoJson={limitesGeoJson} />
        )}
      </MapContainer>
      {!hasPoints && (
        <div className="map-instruction" aria-hidden="true">
          Digite um município na barra acima e clique em <strong>Gerar amostra</strong> para ver a distribuição no mapa.
        </div>
      )}
      {hasPoints && (
        <div className="map-legend">
          <span className="map-legend-count">{points.length} pontos</span>
          {municipio && <span className="map-legend-mun">{municipio}</span>}
          {source === 'cnefe2022' && <span className="map-legend-source">Fonte: IBGE Censo 2022</span>}
          {hasExtraLayer && (
            <span className="map-legend-extra">Áreas verdes: parques, bosques, mata (Campinas)</span>
          )}
        </div>
      )}
    </div>
  )
}
