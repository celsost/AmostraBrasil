import React, { useMemo, useState } from 'react'
import './TopBar.css'

const DEFAULT_N = 50
const MIN_N = 1
const MAX_N = 500

export default function TopBar({
  onSearch,
  onShowMap,
  onShowData,
  onExportCsv,
  onExportMunicipioShp,
  loading,
  hasPoints = false,
  hasMunicipioSelected = false,
  municipiosOptions = [],
}) {
  const [municipio, setMunicipio] = useState('')
  const [n, setN] = useState(DEFAULT_N)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const [selectedCodibge, setSelectedCodibge] = useState(null)
  const [selectedUf, setSelectedUf] = useState(null)
  const [selectedNome, setSelectedNome] = useState(null)

  const suggestions = useMemo(() => {
    const query = municipio.trim().toLowerCase()
    if (!query || !Array.isArray(municipiosOptions) || municipiosOptions.length === 0) {
      return []
    }
    const maxResults = 20
    const filtered = municipiosOptions.filter((m) => {
      const label = `${m.municipio} ${m.uf}`.toLowerCase()
      return label.includes(query)
    })
    return filtered.slice(0, maxResults)
  }, [municipio, municipiosOptions])

  const handleSubmit = (e) => {
    e.preventDefault()
    const mun = municipio.trim() || 'Brasil'
    const sampleSize = Math.min(MAX_N, Math.max(MIN_N, Number(n) || DEFAULT_N))
    onSearch(mun, sampleSize, selectedCodibge, selectedUf, selectedNome)
    setShowSuggestions(false)
    setHighlightIndex(-1)
  }

  const handleMunicipioChange = (e) => {
    setMunicipio(e.target.value)
    setSelectedCodibge(null)
    setSelectedUf(null)
    setSelectedNome(null)
    setShowSuggestions(true)
    setHighlightIndex(-1)
  }

  const handleSuggestionClick = (item) => {
    const label = `${item.municipio} (${item.uf}) - ${item.codibge}`
    setMunicipio(label)
    setSelectedCodibge(item.codibge || null)
    setSelectedUf(item.uf || null)
    setSelectedNome(item.municipio || null)
    setShowSuggestions(false)
    setHighlightIndex(-1)
  }

  const handleMunicipioKeyDown = (e) => {
    if (!showSuggestions || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex((prev) => (prev + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1))
    } else if (e.key === 'Enter') {
      if (highlightIndex >= 0 && highlightIndex < suggestions.length) {
        e.preventDefault()
        const item = suggestions[highlightIndex]
        handleSuggestionClick(item)
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
      setHighlightIndex(-1)
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <h1 className="topbar-title">Amostra Brasil</h1>
        <form className="topbar-form" onSubmit={handleSubmit}>
          <div className="topbar-input-wrapper">
            <input
              type="text"
              className="topbar-input"
              placeholder="Município (ex: Pindoba, São Paulo)"
              value={municipio}
              onChange={handleMunicipioChange}
              onFocus={() => {
                if (municipio.trim()) setShowSuggestions(true)
              }}
              onBlur={() => {
                // pequeno atraso para permitir clique nas sugestões
                setTimeout(() => setShowSuggestions(false), 100)
              }}
              onKeyDown={handleMunicipioKeyDown}
              disabled={loading}
              aria-label="Nome do município"
              autoComplete="off"
            />
            {showSuggestions && suggestions.length > 0 && (
              <ul className="topbar-suggestions" role="listbox">
                {suggestions.map((item, idx) => (
                  <li
                    key={item.codibge || `${item.uf}-${item.municipio}-${idx}`}
                    className={
                      idx === highlightIndex
                        ? 'topbar-suggestion-item topbar-suggestion-item--active'
                        : 'topbar-suggestion-item'
                    }
                    onMouseDown={(e) => {
                      // prevenir blur imediato do input
                      e.preventDefault()
                      handleSuggestionClick(item)
                    }}
                  >
                    <span className="topbar-suggestion-mun">{item.municipio}</span>
                    <span className="topbar-suggestion-uf">{item.uf}</span>
                    <span className="topbar-suggestion-cod">{item.codibge}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <label className="topbar-label-n">
            <span className="topbar-label-n-text">N</span>
            <input
              type="number"
              className="topbar-input-n"
              min={MIN_N}
              max={MAX_N}
              value={n}
              onChange={(e) => setN(e.target.value)}
              disabled={loading}
              aria-label="Tamanho da amostra (domicílios)"
              title={`Tamanho da amostra (${MIN_N}–${MAX_N} domicílios)`}
            />
          </label>
          <div className="topbar-actions">
            <button type="submit" className="topbar-btn" disabled={loading}>
              {loading ? 'Gerando…' : 'Gerar amostra'}
            </button>
            <button
              type="button"
              className="topbar-btn-secondary"
              onClick={onShowData}
              disabled={loading}
            >
              Dados
            </button>
            <button
              type="button"
              className="topbar-btn-secondary"
              onClick={onShowMap}
              disabled={loading}
            >
              Mapa
            </button>
            <button
              type="button"
              className="topbar-btn-secondary"
              onClick={onExportCsv}
              disabled={loading || !hasPoints}
              title={hasPoints ? 'Baixar CSV com os pontos amostrados' : 'Gere uma amostra antes'}
            >
              {loading ? 'Exportando…' : 'Exportar CSV'}
            </button>
            <button
              type="button"
              className="topbar-btn-secondary"
              onClick={onExportMunicipioShp}
              disabled={loading || !hasMunicipioSelected}
              title={hasMunicipioSelected ? 'Baixar SHP do polígono do município selecionado' : 'Selecione um município na lista'}
            >
              Exportar SHP
            </button>
          </div>
        </form>
      </div>
    </header>
  )
}
