import React, { useState, useCallback, useEffect } from 'react'
import JSZip from 'jszip'
import Papa from 'papaparse'
import TopBar from './components/TopBar'
import MapView from './components/MapView'
import SampleTable from './components/SampleTable'
import './App.css'
import { getMunicipioBoundaryGeoJson } from './lib/municipioBoundary'
import { downloadMunicipioShp } from './lib/exportMunicipioShp'

export default function App() {
  const [points, setPoints] = useState([])
  const [municipio, setMunicipio] = useState('')
  const [municipioUf, setMunicipioUf] = useState(null)
  const [municipioCodibge, setMunicipioCodibge] = useState(null)
  const [municipioNomeIBGE, setMunicipioNomeIBGE] = useState(null)
  const [loading, setLoading] = useState(false)
  const [source, setSource] = useState(null) // 'cnefe2022'
  const [limitesGeoJson, setLimitesGeoJson] = useState(null) // boundary polygon for selected municipio
  const [extraLayerGeoJson, setExtraLayerGeoJson] = useState(null) // parks, forests, lakes (e.g. Campinas)
  const [municipiosOptions, setMunicipiosOptions] = useState([])
  const [error, setError] = useState(null)
  const [viewMode, setViewMode] = useState('map') // 'map' | 'table'
  const [hasDownloadConfigured, setHasDownloadConfigured] = useState(
    () => localStorage.getItem('cnefeDownloadConfigured') === '1'
  )

  // Carrega lista de municípios diretamente da API de localidades do IBGE,
  // similar ao que o backend fazia antes.
  useEffect(() => {
    let cancelled = false

    const fetchMunicipios = async () => {
      try {
        const res = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/municipios')
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && Array.isArray(data)) {
          const options = data
            .map((m) => {
              const codibge = String(m.id || '').padStart(7, '0')
              // UF pode vir em caminhos diferentes; tentamos microrregiao/mesorregiao/UF
              let uf = ''
              try {
                uf =
                  m?.microrregiao?.mesorregiao?.UF?.sigla ||
                  m?.regiaoimediata?.regiaointermediaria?.UF?.sigla ||
                  ''
              } catch {
                uf = ''
              }
              return {
                uf: uf || '',
                municipio: m.nome || '',
                codibge,
              }
            })
            .filter((o) => o.municipio && o.codibge)

          const sorted = options.sort((a, b) => {
            const ufA = (a.uf || '').localeCompare(b.uf || '')
            if (ufA !== 0) return ufA
            return (a.municipio || '').localeCompare(b.municipio || '')
          })

          setMunicipiosOptions(sorted)
        }
      } catch {
        // Se falhar, o usuário ainda pode digitar manualmente.
      }
    }

    fetchMunicipios()

    return () => {
      cancelled = true
    }
  }, [])

  function slugFromNome(nome) {
    return (nome || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/\s+/g, '_')
  }

  function getZipUrl(codibge, uf, nomeMunicipio) {
    const ufCode = String(codibge).slice(0, 2)
    const folder = `${ufCode}_${uf}`
    const baseUrl =
      'https://ftp.ibge.gov.br/Cadastro_Nacional_de_Enderecos_para_Fins_Estatisticos/' +
      'Censo_Demografico_2022/Arquivos_CNEFE/CSV/Municipio'
    const slug = slugFromNome(nomeMunicipio)
    const zipName = `${String(codibge).padStart(7, '0')}_${slug}.zip`
    return `${baseUrl}/${folder}/${zipName}`
  }

  async function fetchZipParseAndSample(zipUrl, n) {
    const res = await fetch(zipUrl)
    if (!res.ok) throw new Error('Falha ao baixar o arquivo do município (verifique o código e o nome).')
    const blob = await res.blob()
    const zip = await JSZip.loadAsync(blob)
    const csvEntry = Object.values(zip.files).find((f) => !f.dir && f.name.toLowerCase().endsWith('.csv'))
    if (!csvEntry) throw new Error('Nenhum arquivo CSV encontrado no ZIP.')
    const csvText = await csvEntry.async('string')
    const parsed = Papa.parse(csvText, {
      delimiter: ';',
      header: true,
      skipEmptyLines: true,
    })
    const rows = parsed.data
    if (!rows.length) throw new Error('CSV vazio ou sem dados.')

    const headers = Object.keys(rows[0])
    const latKey = headers.find((h) => h.toUpperCase().trim() === 'LATITUDE') || 'LATITUDE'
    const lngKey = headers.find((h) => h.toUpperCase().trim() === 'LONGITUDE') || 'LONGITUDE'

    const num = (v) => {
      const s = String(v ?? '').trim().replace(',', '.')
      const x = Number(s)
      return Number.isFinite(x) ? x : null
    }
    const normalizeCoord = (raw, limit) => {
      if (raw == null) return null
      const a = Math.abs(raw)
      if (a <= limit) return raw
      // If value looks like degrees * 1e6 (typical CNEFE pattern), rescale
      if (a > limit && a < limit * 1e7) return raw / 1_000_000
      return raw
    }
    const withCoords = rows.filter((r) => num(r[latKey]) != null && num(r[lngKey]) != null)
    const sampleSize = Math.min(Number(n) || 50, withCoords.length)
    const shuffled = [...withCoords].sort(() => Math.random() - 0.5)
    const sampled = shuffled.slice(0, sampleSize)

    return sampled.map((r) => {
      const rawLat = num(r[latKey])
      const rawLng = num(r[lngKey])
      const lat = normalizeCoord(rawLat, 90)
      const lng = normalizeCoord(rawLng, 180)
      const endParts = [
        r['NM_LOGRADOURO'] ?? r['LOGRADOURO'] ?? '',
        r['NUMERO'] ?? r['NR_ENDERECO'] ?? '',
        r['NM_BAIRRO'] ?? r['BAIRRO'] ?? '',
      ].filter(Boolean)
      const endIBGE = endParts.length ? endParts.join(', ') : `Lat ${lat}, Lng ${lng}`
      const point = { lat, lng, endIBGE }
      headers.forEach((h) => {
        if (h !== latKey && h !== lngKey && r[h] !== undefined && r[h] !== '') {
          point[h] = r[h]
        }
      })
      return point
    })
  }

  const handleSearch = useCallback(
    async (mun, n = 50, codibge = null, uf = null, nomeMunicipio = null) => {
      setLoading(true)
      setMunicipio(mun)
      setMunicipioUf(uf)
      setMunicipioCodibge(codibge)
      setMunicipioNomeIBGE(nomeMunicipio)
      setSource(null)
      setError(null)
      setPoints([])
      setLimitesGeoJson(null)
      setExtraLayerGeoJson(null)
      try {
        if (!codibge || !uf || !nomeMunicipio) {
          throw new Error(
            'Selecione um município válido na lista (com UF, código IBGE e nome reconhecido).'
          )
        }
        if (!hasDownloadConfigured) {
          localStorage.setItem('cnefeDownloadConfigured', '1')
          setHasDownloadConfigured(true)
        }
        const cod = String(codibge).padStart(7, '0')
        const zipUrl = getZipUrl(cod, uf, nomeMunicipio)
        // Carrega limites municipais e amostra em paralelo.
        const limitesPromise = getMunicipioBoundaryGeoJson(cod)
          .then((fc) => setLimitesGeoJson(fc))
          .catch((e) => {
            console.warn('Falha ao carregar limites municipais:', e)
            setLimitesGeoJson({ type: 'FeatureCollection', features: [] })
          })

        const samplePoints = await fetchZipParseAndSample(zipUrl, n)
        setPoints(samplePoints)
        setSource('cnefe2022')

        // Espera também a conversão dos limites terminar para esconder o "aguarde".
        await limitesPromise
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setPoints([])
      } finally {
        setLoading(false)
      }
    },
    [hasDownloadConfigured]
  )

  const handleExportCsv = useCallback(async () => {
    if (!points.length) return
    setError(null)

    // Columns to export (must match table)
    const headers = [
      'lat',
      'lng',
      'CEP',
      'COD_DISTRITO',
      'COD_ESPECIE',
      'DSC_LOCALIDADE',
      'NOM_TIPO_SEGLOGR',
      'NOM_SEGLOGR',
      'NUM_ENDERECO',
    ]

    const escapeCsv = (value) => {
      if (value === null || value === undefined) return ''
      const s = String(value)
      if (/[;"\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`
      }
      return s
    }

    const sep = '\t'
    const lines = []
    lines.push(headers.join(sep))
    points.forEach((row) => {
      const line = headers
        .map((h) => {
          const v = row[h]
          return escapeCsv(v)
        })
        .join(sep)
      lines.push(line)
    })
    const csvContent = lines.join('\r\n')

    // Build filename: NomeMunicipio_UF_CODIBGE.csv
    const nome = municipioNomeIBGE || municipio || 'municipio'
    const uf = municipioUf || 'UF'
    const cod = municipioCodibge ? String(municipioCodibge).padStart(7, '0') : '0000000'
    const base = `${nome}_${uf}_${cod}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\-]+/g, '_')
    const filename = `${base}.csv`

    try {
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao exportar CSV.')
    }
  }, [points, municipio, municipioNomeIBGE, municipioUf, municipioCodibge])

  const handleExportMunicipioShp = useCallback(async () => {
    if (!municipioCodibge) return
    setError(null)
    try {
      // Reusa os limites já carregados, senão carrega sob demanda.
      let fc = limitesGeoJson
      if (!fc || !fc.features || fc.features.length === 0) {
        const cod = String(municipioCodibge).padStart(7, '0')
        fc = await getMunicipioBoundaryGeoJson(cod)
      }

      if (!fc || !fc.features || fc.features.length === 0) {
        throw new Error('Não foi possível localizar o polígono do município para exportar.')
      }

      const slug = municipioNomeIBGE
        ? municipioNomeIBGE
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, '_')
        : municipio

      const uf = municipioUf || 'UF'
      const cod = String(municipioCodibge).padStart(7, '0')
      const baseName = `${slug}_${uf}_${cod}`

      let dirHandle = null
      if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
        try {
          dirHandle = await window.showDirectoryPicker()
        } catch (e) {
          if (e.name !== 'AbortError') throw e
          dirHandle = null
        }
      }

      const result = await downloadMunicipioShp(fc, baseName, dirHandle)
      if (result?.mode === 'directory') {
        window.alert(
          `Arquivos do município gravados na pasta:\n- ${result.files
            .map((f) => f.name)
            .join('\n- ')}`
        )
      }
      if (result?.mode === 'downloads') {
        window.alert(
          `Foram disparados ${result.files.length} downloads: \n- ${result.files.join('\n- ')}`
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao exportar shapefile do município.')
    }
  }, [limitesGeoJson, municipioCodibge, municipioNomeIBGE, municipio, municipioUf])

  return (
    <div className="app">
      <TopBar
        onSearch={handleSearch}
        onShowMap={() => setViewMode('map')}
        onShowData={() => setViewMode('table')}
        onExportCsv={handleExportCsv}
        onExportMunicipioShp={handleExportMunicipioShp}
        loading={loading}
        hasPoints={points.length > 0}
        hasMunicipioSelected={!!municipioCodibge && !!municipioUf && !!municipioNomeIBGE}
        municipiosOptions={municipiosOptions}
      />
      <div className="app-map-rect">
        {loading && (
          <div className="importing-overlay" role="status" aria-live="polite">
            <div className="importing-card">
              <div className="importing-spinner" aria-hidden="true" />
              <div className="importing-text">Aguarde… importando dados</div>
            </div>
          </div>
        )}
        {error && (
          <div className="app-error" role="alert">
            <strong>Erro ao obter amostra de domicílios:</strong>{' '}
            <span>{error}</span>
          </div>
        )}
        {viewMode === 'map' ? (
          <MapView
            points={points}
            municipio={municipio}
            source={source}
            limitesGeoJson={limitesGeoJson}
            extraLayerGeoJson={extraLayerGeoJson}
          />
        ) : (
          <SampleTable points={points} />
        )}
      </div>
    </div>
  )
}
