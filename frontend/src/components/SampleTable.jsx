import React, { useMemo } from 'react'
import './SampleTable.css'

export default function SampleTable({ points }) {
  const columns = useMemo(() => {
    if (!points || points.length === 0) return []
    const desired = [
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
    const available = new Set(Object.keys(points[0] || {}))
    return desired.filter((c) => available.has(c))
  }, [points])

  if (!points || points.length === 0) {
    return (
      <div className="sample-table-empty">
        Nenhum domicílio foi sorteado ainda. Gere uma amostra para visualizar a tabela.
      </div>
    )
  }

  return (
    <div className="sample-table-container">
      <table className="sample-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((p, idx) => (
            <tr key={idx}>
              {columns.map((col) => (
                <td key={col}>{p[col] != null ? String(p[col]) : ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

