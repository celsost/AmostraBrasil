import write from 'shp-write/src/write.js'
import geojson from 'shp-write/src/geojson.js'

function toU8(data) {
  if (data == null) return new Uint8Array(0)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (data.buffer instanceof ArrayBuffer) {
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    return new Uint8Array(buf)
  }
  return new Uint8Array(0)
}

/**
 * Export a polygon FeatureCollection as a shapefile (4 files) in the browser.
 * @param {GeoJSON.FeatureCollection} limitesGeoJson - contains the municipality polygon feature
 * @param {string} baseFilename - basename used for .shp/.shx/.dbf/.prj
 * @param {FileSystemDirectoryHandle|null} dirHandle
 */
export function downloadMunicipioShp(limitesGeoJson, baseFilename, dirHandle = null) {
  const fc = limitesGeoJson
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features) || fc.features.length === 0) {
    throw new Error('Limites municipais não disponíveis para exportar.')
  }

  const converted = geojson.polygon(fc)
  if (!converted || !Array.isArray(converted.geometries) || converted.geometries.length === 0) {
    throw new Error('Falha ao converter polígono para shapefile.')
  }

  return new Promise((resolve, reject) => {
    try {
      write(converted.properties, converted.type, converted.geometries, (err, files) => {
        if (err) {
          reject(err)
          return
        }
        if (!files || !files.shp || !files.shx || !files.dbf) {
          reject(new Error('Shapefile não gerado (shp/shx/dbf ausentes).'))
          return
        }

        const shpBuf = toU8(files.shp)
        const shxBuf = toU8(files.shx)
        const dbfBuf = toU8(files.dbf)
        const prjText = files.prj || ''

        const outFiles = [
          { name: `${baseFilename}.shp`, blob: new Blob([shpBuf], { type: 'application/octet-stream' }) },
          { name: `${baseFilename}.shx`, blob: new Blob([shxBuf], { type: 'application/octet-stream' }) },
          { name: `${baseFilename}.dbf`, blob: new Blob([dbfBuf], { type: 'application/octet-stream' }) },
          { name: `${baseFilename}.prj`, blob: new Blob([prjText], { type: 'text/plain' }) },
        ]

        if (dirHandle) {
          ;(async () => {
            if (typeof dirHandle.requestPermission === 'function') {
              const perm = await dirHandle.requestPermission({ mode: 'readwrite' })
              if (perm !== 'granted') {
                throw new Error('Permissão negada para salvar arquivos na pasta.')
              }
            }
            const written = []
            for (const f of outFiles) {
              const fh = await dirHandle.getFileHandle(f.name, { create: true })
              const w = await fh.createWritable()
              const ab = await f.blob.arrayBuffer()
              await w.write(ab)
              await w.close()
              const saved = await fh.getFile()
              if (!saved || typeof saved.size !== 'number' || saved.size <= 0) {
                throw new Error(`Arquivo gravado com 0 bytes: ${f.name}`)
              }
              written.push({ name: f.name, size: saved.size })
            }
            resolve({ mode: 'directory', files: written })
          })().catch(reject)
          return
        }

        // Fallback: 4 downloads
        for (const f of outFiles) {
          const url = URL.createObjectURL(f.blob)
          const a = document.createElement('a')
          a.href = url
          a.download = f.name
          a.style.display = 'none'
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          setTimeout(() => URL.revokeObjectURL(url), 2000)
        }
        resolve({ mode: 'downloads', files: outFiles.map((f) => f.name) })
      })
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

