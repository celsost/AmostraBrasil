import shp from 'shpjs'

const MUNICIPIOS_ZIP_URL =
  'https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2024/Brasil/BR_Municipios_2024.zip'

let cachedMunicipiosGeoJsonPromise = null

function normalizeCod(value) {
  if (value == null) return null
  const digits = String(value).replace(/\D/g, '')
  return digits.length ? digits : null
}

function matchesMunicipioCod(props, codStr) {
  if (!props) return false
  const entries = Object.entries(props)

  // 1) Preferência: chaves que parecem conter código do município
  for (const [k, v] of entries) {
    if (v == null) continue
    const key = k.toUpperCase()
    if (!/(MUN|MUNIC|GEOCOD|CD_?GEOCODMUN|CODMUN|COD_MUN)/.test(key)) continue
    const valDigits = normalizeCod(v)
    if (valDigits && valDigits === codStr) return true
  }

  // 2) Fallback: qualquer valor que bata os 7 dígitos
  for (const [, v] of entries) {
    const valDigits = normalizeCod(v)
    if (valDigits && valDigits === codStr) return true
  }

  return false
}

async function loadMunicipiosGeoJson() {
  console.info('[limites] Baixando e convertendo BR_Municipios_2024.zip (isso pode demorar)…')
  const res = await fetch(MUNICIPIOS_ZIP_URL)
  if (!res.ok) {
    throw new Error(`Falha ao baixar limites municipais (ZIP). Status: ${res.status}`)
  }
  const ab = await res.arrayBuffer()
  console.info('[limites] ZIP baixado, convertendo shapefile para GeoJSON…')
  const parsed = await shp(ab)

  // shpjs pode retornar um array quando o ZIP tem múltiplos shapefiles
  const fc = Array.isArray(parsed) ? parsed[0] : parsed
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    throw new Error('Falha ao converter shapefile de municípios para GeoJSON.')
  }
  console.info('[limites] Conversão concluída. Features:', fc.features.length)
  return fc
}

/**
 * Retorna um FeatureCollection com apenas o polígono (Feature) do município.
 * @param {string|number} codibge - 7 dígitos (ex.: 3507704)
 */
export async function getMunicipioBoundaryGeoJson(codibge) {
  const codStr = String(codibge).padStart(7, '0')

  if (!cachedMunicipiosGeoJsonPromise) {
    cachedMunicipiosGeoJsonPromise = loadMunicipiosGeoJson()
  }

  const fc = await cachedMunicipiosGeoJsonPromise
  const feature =
    fc.features?.find((f) => matchesMunicipioCod(f?.properties, codStr)) || null
  console.info('[limites] Município', codStr, 'encontrado?', Boolean(feature))

  return {
    type: 'FeatureCollection',
    features: feature ? [feature] : [],
  }
}

